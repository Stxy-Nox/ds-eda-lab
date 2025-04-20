import { SQSHandler } from "aws-lambda";
import {
  DynamoDBClient,
  UpdateItemCommand,
  UpdateItemCommandInput,
  GetItemCommand,
  GetItemCommandInput,
} from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient();
const imagesTable = process.env.IMAGES_TABLE;

// Valid metadata types
const VALID_METADATA_TYPES = ["Caption", "Date", "name"];

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));

  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    const snsMessage = JSON.parse(recordBody.Message);
    
    // Get metadata type from message attributes
    const messageAttributes = recordBody.MessageAttributes || {};
    const metadataType = messageAttributes.metadata_type?.StringValue;
    
    if (!metadataType || !VALID_METADATA_TYPES.includes(metadataType)) {
      console.error(`Invalid metadata type: ${metadataType}`);
      continue; // Skip invalid metadata type
    }
    
    try {
      // Parse message body to get image ID and metadata value
      const { id, value } = snsMessage;
      
      if (!id || !value) {
        console.error("Invalid message format - missing id or value");
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
      
      // Update metadata
      const updateParams: UpdateItemCommandInput = {
        TableName: imagesTable,
        Key: {
          id: { S: id },
        },
        UpdateExpression: `SET ${metadataType.toLowerCase()} = :value`,
        ExpressionAttributeValues: {
          ":value": { S: value },
        },
      };
      
      await dynamodb.send(new UpdateItemCommand(updateParams));
      console.log(`Updated ${metadataType} for image ${id}: ${value}`);
      
    } catch (error) {
      console.error("Error processing metadata update:", error);
    }
  }
}; 