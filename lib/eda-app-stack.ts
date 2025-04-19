import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for storing images
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // DynamoDB table for images metadata
    const imagesTable = new dynamodb.Table(this, "ImagesTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Integration infrastructure - SNS Topic
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    }); 

    // Dead Letter Queue for invalid images
    const imagesDLQ = new sqs.Queue(this, "images-dlq", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    // Main queue for processing valid images with DLQ
    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: imagesDLQ,
        maxReceiveCount: 3
      }
    });

    // Queue for metadata updates
    const metadataUpdateQueue = new sqs.Queue(this, "metadata-update-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    // Queue for status updates
    const statusUpdateQueue = new sqs.Queue(this, "status-update-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    // Queue for confirmation emails
    const mailerQueue = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });

    // Lambda functions

    // 1. Log Image Lambda - validates image type and logs to DynamoDB
    const logImageFn = new lambdanode.NodejsFunction(this, "LogImageFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/logImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        IMAGES_TABLE: imagesTable.tableName,
      },
    });

    // 2. Add Metadata Lambda - updates image metadata
    const addMetadataFn = new lambdanode.NodejsFunction(this, "AddMetadataFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/addMetadata.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        IMAGES_TABLE: imagesTable.tableName,
      },
    });

    // 3. Update Status Lambda - updates review status
    const updateStatusFn = new lambdanode.NodejsFunction(this, "UpdateStatusFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/updateStatus.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        IMAGES_TABLE: imagesTable.tableName,
        MAILER_QUEUE_URL: mailerQueue.queueUrl
      },
    });

    // 4. Remove Image Lambda - removes invalid images from DLQ
    const removeImageFn = new lambdanode.NodejsFunction(this, "RemoveImageFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/removeImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
    });

    // 5. Confirmation Mailer Lambda - sends status update emails
    const confirmationMailerFn = new lambdanode.NodejsFunction(this, "ConfirmationMailerFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(15),
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
      environment: {
        IMAGES_TABLE: imagesTable.tableName,
      },
    });

    // Event Sources

    // S3 -> SNS (image uploads trigger SNS)
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // SNS -> SQS subscriptions with filters
    
    // 1. Filter for image processing (only jpg/png)
    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue, {
        filterPolicy: {
          "eventName": sns.SubscriptionFilter.stringFilter({
            allowlist: ["ObjectCreated:Put", "ObjectCreated:Post"]
          })
        }
      })
    );

    // 2. Filter for metadata updates
    newImageTopic.addSubscription(
      new subs.SqsSubscription(metadataUpdateQueue, {
        filterPolicy: {
          "metadata_type": sns.SubscriptionFilter.stringFilter({
            allowlist: ["Caption", "Date", "name"]
          })
        }
      })
    );

    // 3. Filter for status updates
    newImageTopic.addSubscription(
      new subs.SqsSubscription(statusUpdateQueue, {
        filterPolicy: {
          "status": sns.SubscriptionFilter.existsFilter()
        }
      })
    );

    // SQS -> Lambda event sources
    
    // 1. Log Image Lambda
    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    logImageFn.addEventSource(newImageEventSource);

    // 2. Add Metadata Lambda
    const metadataEventSource = new events.SqsEventSource(metadataUpdateQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    addMetadataFn.addEventSource(metadataEventSource);

    // 3. Update Status Lambda
    const statusEventSource = new events.SqsEventSource(statusUpdateQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    updateStatusFn.addEventSource(statusEventSource);

    // 4. Remove Image Lambda (processes DLQ messages)
    const dlqEventSource = new events.SqsEventSource(imagesDLQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    removeImageFn.addEventSource(dlqEventSource);

    // 5. Confirmation Mailer Lambda
    const mailerEventSource = new events.SqsEventSource(mailerQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    confirmationMailerFn.addEventSource(mailerEventSource);

    // Permissions

    // S3 permissions
    imagesBucket.grantRead(logImageFn);
    imagesBucket.grantDelete(removeImageFn);

    // DynamoDB permissions
    imagesTable.grantWriteData(logImageFn);
    imagesTable.grantReadWriteData(addMetadataFn);
    imagesTable.grantReadWriteData(updateStatusFn);
    imagesTable.grantReadData(confirmationMailerFn);

    // SQS permissions
    mailerQueue.grantSendMessages(updateStatusFn);

    // SES permissions for email sending
    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "tableName", {
      value: imagesTable.tableName,
    });

    new cdk.CfnOutput(this, "topicArn", {
      value: newImageTopic.topicArn,
    });
  }
}
