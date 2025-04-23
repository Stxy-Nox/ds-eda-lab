import { SQSHandler } from "aws-lambda";
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});
const imagesTable = process.env.IMAGES_TABLE!;
const VALID = ["Caption", "Date", "name"];

export const handler: SQSHandler = async (event) => {
  for (const rec of event.Records) {
    const body = JSON.parse(rec.body);
    const attrs = body.MessageAttributes || {};
    const metaType = attrs.metadata_type?.Value;
    if (!metaType || !VALID.includes(metaType)) continue;

    const msg = JSON.parse(body.Message);
    const { id, value } = msg;
    if (!id || !value) continue;

    // 确保存在
    const got = await dynamodb.send(
      new GetItemCommand({
        TableName: imagesTable,
        Key: { id: { S: id } },
      })
    );
    if (!got.Item) continue;

    // 更新
    await dynamodb.send(
      new UpdateItemCommand({
        TableName: imagesTable,
        Key: { id: { S: id } },
        UpdateExpression: `SET ${metaType.toLowerCase()} = :v`,
        ExpressionAttributeValues: { ":v": { S: value } },
      })
    );
    console.log(`Updated ${id} ${metaType}`);
  }
}; 