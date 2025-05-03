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

    // 1. S3 Bucket for storing images
    const imagesBucket = new s3.Bucket(this, "ImagesBucket", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2. DynamoDB table for images metadata
    const imagesTable = new dynamodb.Table(this, "ImagesTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. SNS Topic
    const newImageTopic = new sns.Topic(this, "NewImageTopic");

    // 4. SQS Queues
    const imagesDLQ = new sqs.Queue(this, "ImagesDLQ");
    const imageProcessQueue = new sqs.Queue(this, "ImageProcessQueue", {
      deadLetterQueue: { queue: imagesDLQ, maxReceiveCount: 3 },
      visibilityTimeout: cdk.Duration.seconds(30),
    });
    const metadataUpdateQueue = new sqs.Queue(this, "MetadataUpdateQueue");
    const statusUpdateQueue = new sqs.Queue(this, "StatusUpdateQueue");
    const mailerQueue = new sqs.Queue(this, "MailerQueue");
    const rejectImageQueue = new sqs.Queue(this, "RejectImageQueue");

    // 5. Lambda functions
    const logImageFn = new lambdanode.NodejsFunction(this, "LogImageFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/logImage.ts`,
      handler: "handler",
      environment: { 
        IMAGES_TABLE: imagesTable.tableName 
      },
      timeout: cdk.Duration.seconds(15),
    });

    const addMetadataFn = new lambdanode.NodejsFunction(this, "AddMetadataFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/addMetadata.ts`,
      handler: "handler",
      environment: { 
        IMAGES_TABLE: imagesTable.tableName 
      },
      timeout: cdk.Duration.seconds(15),
    });

    const updateStatusFn = new lambdanode.NodejsFunction(this, "UpdateStatusFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/updateStatus.ts`,
      handler: "handler",
      environment: { 
        IMAGES_TABLE: imagesTable.tableName
      },
      timeout: cdk.Duration.seconds(15),
    });

    const removeImageFn = new lambdanode.NodejsFunction(this, "RemoveImageFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/removeImage.ts`,
      handler: "handler",
      environment: {
        IMAGES_TABLE: imagesTable.tableName
      },
      timeout: cdk.Duration.seconds(15),
    });

    const confirmationMailerFn = new lambdanode.NodejsFunction(this, "ConfirmationMailerFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
      handler: "handler",
      environment: {
        IMAGES_TABLE: imagesTable.tableName,
        SES_EMAIL_FROM: "20108800@mail.wit.ie", 
        SES_REGION: this.region,
      },
      timeout: cdk.Duration.seconds(15),
    });

    // 6. S3 -> SNS
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // 7. SNS -> SQS Subscriptions (Fan-out + 过滤)
    //  7.1 所有新对象都给 LogImage
    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue)
    );

    //  7.2 元数据更新消息
    newImageTopic.addSubscription(
      new subs.SqsSubscription(metadataUpdateQueue, {
        filterPolicy: {
          metadata_type: sns.SubscriptionFilter.existsFilter(),
        },
      })
    );

    //  7.3 状态更新消息
    const statusFilter = {
      messageType: sns.SubscriptionFilter.stringFilter({
        allowlist: ["StatusUpdate"],
      }),
    };
    newImageTopic.addSubscription(
      new subs.SqsSubscription(statusUpdateQueue, {
        filterPolicy: statusFilter,
      })
    );
    
    //  7.4 同样把状态更新推给邮件队列
    newImageTopic.addSubscription(
      new subs.SqsSubscription(mailerQueue, { 
        filterPolicy: statusFilter 
      })
    );

    //  7.5 将拒绝的图片消息发送到删除队列
    const rejectFilter = {
      messageType: sns.SubscriptionFilter.stringFilter({
        allowlist: ["StatusUpdate"],
      }),
      update: sns.SubscriptionFilter.stringFilter({
        matchPrefixes: [JSON.stringify({ status: "Reject" })],
      }),
    };
    newImageTopic.addSubscription(
      new subs.SqsSubscription(rejectImageQueue, { 
        filterPolicy: rejectFilter
      })
    );

    // 8. SQS -> Lambda Event Sources
    logImageFn.addEventSource(
      new events.SqsEventSource(imageProcessQueue, { batchSize: 5 })
    );
    
    addMetadataFn.addEventSource(
      new events.SqsEventSource(metadataUpdateQueue, { batchSize: 5 })
    );
    
    updateStatusFn.addEventSource(
      new events.SqsEventSource(statusUpdateQueue, { batchSize: 5 })
    );
    
    confirmationMailerFn.addEventSource(
      new events.SqsEventSource(mailerQueue, { batchSize: 5 })
    );
    
    removeImageFn.addEventSource(
      new events.SqsEventSource(rejectImageQueue, { batchSize: 5 })
    );

    // 9. Permissions
    imagesBucket.grantRead(logImageFn);
    imagesBucket.grantDelete(removeImageFn);
    imagesBucket.grantRead(removeImageFn);

    imagesTable.grantWriteData(logImageFn);
    imagesTable.grantReadWriteData(addMetadataFn);
    imagesTable.grantReadWriteData(updateStatusFn);
    imagesTable.grantReadData(confirmationMailerFn);
    imagesTable.grantReadData(removeImageFn);

    // SES permissions
    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      })
    );

    // Output
    new cdk.CfnOutput(this, "BucketName", {
      value: imagesBucket.bucketName,
    });
    
    new cdk.CfnOutput(this, "TableName", {
      value: imagesTable.tableName,
    });
    
    new cdk.CfnOutput(this, "TopicArn", {
      value: newImageTopic.topicArn,
    });
  }
}
