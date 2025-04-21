# Event-Driven Architecture Photo Gallery

This application manages a photo gallery using an Event Driven Architecture (EDA) deployed on AWS. The system allows photographers to upload images and moderators to review them.

## Architecture Overview

The application uses the following AWS services:

- **Amazon S3**: Store image files
- **Amazon SNS**: Message publish/subscribe
- **Amazon SQS**: Message queues including Dead Letter Queue (DLQ)
- **AWS Lambda**: Serverless functions
- **Amazon DynamoDB**: NoSQL database
- **Amazon SES**: Email service

## Features

1. **Photographer Features**:
   - Upload photos (.jpeg, .jpg, .png) to S3 bucket
   - Add photo metadata (caption, date, photographer name)
   - Receive upload confirmation and status change notifications

2. **Moderator Features**:
   - Review uploaded photos
   - Submit review decisions (Pass/Reject) with reasons
   
3. **System Features**:
   - Automatic logging of valid photo uploads
   - Automatic removal of invalid file types
   - Metadata management
   - Email notifications

## Deployment Instructions

### Prerequisites

- AWS CLI configured
- Node.js 18+
- AWS CDK installed

### Deployment Steps

1. Install dependencies:
   ```
   npm install
   ```

2. Deploy the application:
   ```
   npm run cdk deploy
   ```

## Usage Instructions

### Upload Photos (Photographer)

1. Use AWS S3 console or CLI to upload images

### Add Photo Metadata (Photographer)

Use AWS CLI to send SNS messages:

```bash
aws sns publish --topic-arn "your-topic-arn" --message-attributes file://attributes.json --message file://message.json
```

`attributes.json` example:
```json
{
  "metadata_type": {
    "DataType": "String",
    "StringValue": "Caption"
  }
}
```

`message.json` example:
```json
{
  "id": "image1.jpeg",
  "value": "Olympic 100m final - 2024"
}
```

Valid metadata types: `Caption`, `Date`, `name`

### Update Photo Status (Moderator)

Use AWS CLI to send SNS messages:

```bash
aws sns publish --topic-arn "your-topic-arn" --message file://status.json
```

`status.json` example:
```json
{
  "id": "image1.jpeg",
  "date": "01/05/2025",
  "update": {
    "status": "Pass", 
    "reason": "High quality sports photo"
  }
}
```

Valid status values: `Pass`, `Reject`

## Implementation Details

The system consists of the following components:

1. **Log Image Lambda**: Validates image file types and logs to DynamoDB
2. **Add Metadata Lambda**: Updates image metadata in DynamoDB
3. **Update Status Lambda**: Updates review status and triggers notifications
4. **Remove Image Lambda**: Removes invalid files from the S3 bucket
5. **Confirmation Mailer Lambda**: Sends email notifications for status changes

Message filtering ensures each function only processes relevant events.

