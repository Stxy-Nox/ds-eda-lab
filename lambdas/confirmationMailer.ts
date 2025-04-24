import { SQSHandler } from "aws-lambda";
import {
  SESClient,
  SendEmailCommand,
} from "@aws-sdk/client-ses";
import {
  DynamoDBClient,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";

const ses = new SESClient({ region: process.env.SES_REGION });
const db = new DynamoDBClient({});
const tableName = process.env.IMAGES_TABLE!;
const source = process.env.SES_EMAIL_FROM!;

export const handler: SQSHandler = async (event) => {
  for (const rec of event.Records) {
    // 1. 解析 SNS 经过 SQS 的包裹
    const wrapper = JSON.parse(rec.body);
    const snsMsg = JSON.parse(wrapper.Message);
    const { id, date, update } = snsMsg;
    const { status, reason } = update;

    // 2. 拿摄影师姓名
    const got = await db.send(
      new GetItemCommand({
        TableName: tableName,
        Key: { id: { S: id } },
      })
    );
    const name = got.Item?.name?.S || "摄影师";

    // 3. 发邮件
    const subj = `照片状态更新: ${status}`;
    const html = `
      <html><body>
        <h2>您好，${name}</h2>
        <p>您的照片 <strong>${id}</strong> 已被审核。</p>
        <ul>
          <li>状态: ${status}</li>
          <li>原因: ${reason}</li>
          <li>审核日期: ${date}</li>
        </ul>
        <p>感谢使用！</p>
      </body></html>
    `;
    await ses.send(
      new SendEmailCommand({
        Source: source,
        Destination: { ToAddresses: [source] },
        Message: {
          Subject: { Data: subj },
          Body: { Html: { Data: html } },
        },
      })
    );
    console.log("Email sent for", id);
  }
}; 