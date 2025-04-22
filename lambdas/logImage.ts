/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  S3Client,
  GetObjectCommand,
  GetObjectCommandInput,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandInput,
} from "@aws-sdk/client-dynamodb";

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const imagesTable = process.env.IMAGES_TABLE!;
const VALID_IMAGE_TYPES = [".jpeg", ".jpg", ".png"];

export const handler: SQSHandler = async (event) => {
  for (const rec of event.Records) {
    const body = JSON.parse(rec.body);
    const snsMsg = JSON.parse(body.Message);

    for (const record of snsMsg.Records) {
      const { bucket, object } = record.s3;
      const key = decodeURIComponent(object.key.replace(/\+/g, " "));
      
      // 后缀校验
      if (!VALID_IMAGE_TYPES.some((ext) => key.toLowerCase().endsWith(ext))) {
        console.error("Invalid type:", key);
        throw new Error("仅支持 .jpeg/.jpg/.png");
      }
      
      // 读 S3 验真
      await s3.send(
        new GetObjectCommand({ Bucket: bucket.name, Key: key })
      );
      
      // 写 Dynamo
      await dynamodb.send(
        new PutItemCommand({
          TableName: imagesTable,
          Item: {
            id: { S: key },
            uploadTime: { S: new Date().toISOString() },
            bucket: { S: bucket.name },
          },
        } as PutItemCommandInput)
      );
      console.log("Logged:", key);
    }
  }
}; 