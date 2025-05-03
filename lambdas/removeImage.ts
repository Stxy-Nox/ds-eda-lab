import { SQSHandler } from "aws-lambda";
import {
  S3Client,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import {
  DynamoDBClient,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const imagesTable = process.env.IMAGES_TABLE!;

export const handler: SQSHandler = async (event) => {
  for (const rec of event.Records) {
    try {
      const body = JSON.parse(rec.body);
      const snsMsg = JSON.parse(body.Message);
      
      // 检查是来自S3事件的直接消息还是状态更新消息
      if (snsMsg.Records) {
        // 处理来自S3事件的消息（旧格式）
        for (const r of snsMsg.Records) {
          const { bucket, object } = r.s3;
          const key = decodeURIComponent(object.key.replace(/\+/g, " "));
          await s3.send(
            new DeleteObjectCommand({
              Bucket: bucket.name,
              Key: key,
            })
          );
          console.log("Deleted invalid image from S3 event:", key);
        }
      } else if (snsMsg.id && snsMsg.update?.status === "Reject") {
        // 处理状态更新消息（新格式）
        const imageId = snsMsg.id;
        
        // 从DynamoDB获取图片信息
        const result = await dynamodb.send(
          new GetItemCommand({
            TableName: imagesTable,
            Key: { id: { S: imageId } },
          })
        );
        
        if (result.Item) {
          const bucket = result.Item.bucket?.S;
          
          if (bucket) {
            // 验证S3中是否存在该对象
            try {
              await s3.send(
                new HeadObjectCommand({
                  Bucket: bucket,
                  Key: imageId,
                })
              );
              
              // 删除对象
              await s3.send(
                new DeleteObjectCommand({
                  Bucket: bucket,
                  Key: imageId,
                })
              );
              console.log("Deleted rejected image:", imageId);
            } catch (error) {
              console.error(`Error verifying or deleting image ${imageId}:`, error);
            }
          } else {
            console.error(`Missing bucket information for image ${imageId}`);
          }
        } else {
          console.error(`Image ${imageId} not found in database`);
        }
      } else {
        console.log("Unsupported message format:", JSON.stringify(snsMsg));
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  }
}; 