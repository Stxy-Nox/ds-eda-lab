import { SQSHandler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});
const imagesTable = process.env.IMAGES_TABLE!;
const VALID_STATUS = ["Pass", "Reject"];

export const handler: SQSHandler = async (event) => {
  for (const rec of event.Records) {
    const body = JSON.parse(rec.body);
    const snsMsg = JSON.parse(body.Message);
    const { id, date, update } = snsMsg;
    if (!id || !date || !update?.status || !update?.reason) continue;
    if (!VALID_STATUS.includes(update.status)) continue;

    // 确保存在
    const got = await dynamodb.send(
      new GetItemCommand({
        TableName: imagesTable,
        Key: { id: { S: id } },
      })
    );
    if (!got.Item) continue;

    // 写状态 & 理由 & 审核日
    await dynamodb.send(
      new UpdateItemCommand({
        TableName: imagesTable,
        Key: { id: { S: id } },
        UpdateExpression:
          "SET #st = :s, reason = :r, reviewDate = :d",
        ExpressionAttributeNames: { "#st": "status" },
        ExpressionAttributeValues: {
          ":s": { S: update.status },
          ":r": { S: update.reason },
          ":d": { S: date },
        },
      })
    );
    console.log(`Status updated for ${id}: ${update.status}`);
    // NOTE: 不再手动发 SQS，依赖 SNS Fan-out 到 mailerQueue
  }
}; 