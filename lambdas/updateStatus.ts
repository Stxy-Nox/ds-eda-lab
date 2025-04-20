import { SQSHandler } from "aws-lambda";
import {
  DynamoDBClient,
  UpdateItemCommand,
  UpdateItemCommandInput,
  GetItemCommand,
  GetItemCommandInput,
} from "@aws-sdk/client-dynamodb";
import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
} from "@aws-sdk/client-sqs";

const dynamodb = new DynamoDBClient();
const sqs = new SQSClient();
const imagesTable = process.env.IMAGES_TABLE;
const mailerQueueUrl = process.env.MAILER_QUEUE_URL;

// Valid statuses
const VALID_STATUSES = ["Pass", "Reject"];

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));

  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    const snsMessage = JSON.parse(recordBody.Message);

    try {
      // Parse message body to get image ID, date and status update
      const { id, date, update } = snsMessage;
      
      if (!id || !date || !update || !update.status || !update.reason) {
        console.error("Invalid message format - missing required fields");
        continue;
      }
      
      const { status, reason } = update;
      
      // Validate status
      if (!VALID_STATUSES.includes(status)) {
        console.error(`Invalid status value: ${status}`);
        continue;
      }
      
      // First check if image exists
      const getParams: GetItemCommandInput = {
        TableName: imagesTable,
        Key: {
          id: { S: id },
        },
      };
      
      const getResult = await dynamodb.send(new GetItemCommand(getParams));
      
      if (!getResult.Item) {
        console.error(`Image does not exist: ${id}`);
        continue;
      }
      
      // Get photographer name for notification
      const photographerName = getResult.Item.name?.S || "Unknown Photographer";
      
      // Update status and reason
      const updateParams: UpdateItemCommandInput = {
        TableName: imagesTable,
        Key: {
          id: { S: id },
        },
        UpdateExpression: "SET #status = :status, reason = :reason, reviewDate = :date",
        ExpressionAttributeNames: {
          "#status": "status", // Avoid reserved word conflict
        },
        ExpressionAttributeValues: {
          ":status": { S: status },
          ":reason": { S: reason },
          ":date": { S: date },
        },
      };
      
      await dynamodb.send(new UpdateItemCommand(updateParams));
      console.log(`Updated image ${id} status: ${status}, reason: ${reason}`);
      
      // Send notification message to mailer queue
      const messageBody = {
        imageId: id,
        photographerName,
        status,
        reason,
        reviewDate: date,
      };
      
      const sendParams: SendMessageCommandInput = {
        QueueUrl: mailerQueueUrl,
        MessageBody: JSON.stringify(messageBody),
      };
      
      await sqs.send(new SendMessageCommand(sendParams));
      console.log(`Sent status update notification to mailer queue: ${id}`);
      
    } catch (error) {
      console.error("Error processing status update:", error);
    }
  }
}; 