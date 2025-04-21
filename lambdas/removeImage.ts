import { SQSHandler } from "aws-lambda";
import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectCommandInput,
} from "@aws-sdk/client-s3";

const s3 = new S3Client();

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));

  for (const record of event.Records) {
    try {
      // Get original failed message from DLQ
      const recordBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(recordBody.Message);
      
      if (snsMessage.Records) {
        for (const messageRecord of snsMessage.Records) {
          const s3e = messageRecord.s3;
          const srcBucket = s3e.bucket.name;
          // Object key may have spaces or unicode non-ASCII characters
          const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
          
          console.log(`Processing invalid image from DLQ: ${srcKey}`);
          
          // Delete invalid file from S3 bucket
          const deleteParams: DeleteObjectCommandInput = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          
          await s3.send(new DeleteObjectCommand(deleteParams));
          console.log(`Deleted invalid image: ${srcKey}`);
        }
      } else {
        console.log("Invalid message format, cannot process", record.body);
      }
    } catch (error) {
      console.error("Error processing DLQ message:", error);
    }
  }
}; 