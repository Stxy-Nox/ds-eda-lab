import { SQSHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_REGION } from "../env";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";
import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandInput,
} from "@aws-sdk/client-dynamodb";

if (!SES_EMAIL_FROM || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_FROM and SES_REGION environment variables in an env.ts file located in the root directory"
  );
}

// Define message type
interface StatusUpdateMessage {
  imageId: string;
  photographerName: string;
  status: string;
  reason: string;
  reviewDate: string;
}

// Define email params type
interface EmailParams {
  name: string;
  email: string;
  subject: string;
  message: string;
}

const sesClient = new SESClient({ region: SES_REGION });
const dynamodb = new DynamoDBClient();
const imagesTable = process.env.IMAGES_TABLE;

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));

  for (const record of event.Records) {
    try {
      const messageBody = JSON.parse(record.body);
      
      // Check if this is a status update notification
      if (messageBody.imageId && messageBody.status) {
        await processStatusUpdateNotification(messageBody as StatusUpdateMessage);
      } 
      // Check if this is a new image upload notification
      else if (record.body.includes("Records") && record.body.includes("s3")) {
        const recordBody = JSON.parse(record.body);
        const snsMessage = JSON.parse(recordBody.Message);
        
        if (snsMessage.Records) {
          for (const messageRecord of snsMessage.Records) {
            const s3e = messageRecord.s3;
            const srcBucket = s3e.bucket.name;
            const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
            
            await sendNewImageUploadEmail(srcBucket, srcKey);
          }
        }
      }
    } catch (error) {
      console.error("Error processing mail notification:", error);
    }
  }
};

// Process status update notification
async function processStatusUpdateNotification(message: StatusUpdateMessage): Promise<void> {
  const { imageId, photographerName, status, reason, reviewDate } = message;
  
  // Get image info from DynamoDB
  const getParams: GetItemCommandInput = {
    TableName: imagesTable,
    Key: {
      id: { S: imageId },
    },
  };
  
  try {
    const result = await dynamodb.send(new GetItemCommand(getParams));
    
    if (!result.Item) {
      console.error(`Image does not exist: ${imageId}`);
      return;
    }
    
    // Get photographer email (in a real app, this would be stored in the database)
    // For this demo, we use SES_EMAIL_FROM
    const photographerEmail = SES_EMAIL_FROM;
    
    // Prepare email content
    const emailParams: EmailParams = {
      name: photographerName || "Photographer",
      email: photographerEmail,
      subject: `Photo Status Update: ${status}`,
      message: `
        Your photo (${imageId}) has been reviewed.
        
        Status: ${status}
        Reason: ${reason}
        Review Date: ${reviewDate}
        
        Thank you for using our photo gallery service.
      `
    };
    
    // Send email
    await sendEmail(emailParams);
    console.log(`Sent status update notification email to ${photographerEmail}`);
    
  } catch (error) {
    console.error("Error sending status update notification email:", error);
    throw error;
  }
}

// Send new image upload notification
async function sendNewImageUploadEmail(bucket: string, key: string): Promise<void> {
  try {
    const params: EmailParams = {
      name: "Photo Gallery System",
      email: SES_EMAIL_FROM,
      subject: "New Image Upload Confirmation",
      message: `We received your image. Its URL is s3://${bucket}/${key}`
    };
    
    await sendEmail(params);
    console.log(`Sent new image upload notification email`);
  } catch (error) {
    console.error("Error sending new image upload notification email:", error);
    throw error;
  }
}

// Generic function to send email
async function sendEmail({ name, email, subject, message }: EmailParams): Promise<void> {
  const params: SendEmailCommandInput = {
    Destination: {
      ToAddresses: [email],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: getHtmlContent({ name, email, message }),
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
    },
    Source: SES_EMAIL_FROM,
  };
  
  await sesClient.send(new SendEmailCommand(params));
}

// Generate HTML content
function getHtmlContent({ name, email, message }: { name: string; email: string; message: string }): string {
  return `
    <html>
      <body>
        <h2>To: ${name}</h2>
        <p>${message.replace(/\n/g, '<br/>')}</p>
        <p>Regards,</p>
        <p>Photo Gallery Team</p>
      </body>
    </html> 
  `;
} 