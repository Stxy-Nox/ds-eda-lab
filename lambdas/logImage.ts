/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  GetObjectCommandInput,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandInput,
} from "@aws-sdk/client-dynamodb";

const s3 = new S3Client();
const dynamodb = new DynamoDBClient();
const imagesTable = process.env.IMAGES_TABLE;

// Valid image types
const VALID_IMAGE_TYPES = ['.jpeg', '.jpg', '.png'];

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));
  
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);        // Parse SQS message
    const snsMessage = JSON.parse(recordBody.Message); // Parse SNS message

    if (snsMessage.Records) {
      console.log("Record body ", JSON.stringify(snsMessage));
      
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;
        // Object key may have spaces or unicode non-ASCII characters
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
        
        // Validate file type
        const isValidFileType = VALID_IMAGE_TYPES.some(ext => srcKey.toLowerCase().endsWith(ext));
        
        if (!isValidFileType) {
          console.error(`Invalid file type: ${srcKey}`);
          throw new Error(`Invalid file type: ${srcKey}. Only .jpeg, .jpg and .png files are supported`);
        }
        
        try {
          // Download the image from the S3 source bucket
          const params: GetObjectCommandInput = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          
          await s3.send(new GetObjectCommand(params));
          
          // Log valid image to DynamoDB
          const putParams: PutItemCommandInput = {
            TableName: imagesTable,
            Item: {
              id: { S: srcKey },
              uploadTime: { S: new Date().toISOString() },
              bucket: { S: srcBucket }
            }
          };
          
          await dynamodb.send(new PutItemCommand(putParams));
          console.log(`Logged valid image: ${srcKey}`);
          
        } catch (error) {
          console.error("Error processing image:", error);
          throw error; // Re-throw to send message to DLQ
        }
      }
    }
  }
}; 