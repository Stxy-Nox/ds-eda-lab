import { SQSHandler } from "aws-lambda";
import {
  S3Client,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({});

export const handler: SQSHandler = async (event) => {
  for (const rec of event.Records) {
    const wrapper = JSON.parse(rec.body);
    const snsMsg = JSON.parse(wrapper.Message);
    for (const r of snsMsg.Records) {
      const { bucket, object } = r.s3;
      const key = decodeURIComponent(object.key.replace(/\+/g, " "));
      await s3.send(
        new DeleteObjectCommand({
          Bucket: bucket.name,
          Key: key,
        })
      );
      console.log("Deleted invalid image:", key);
    }
  }
}; 