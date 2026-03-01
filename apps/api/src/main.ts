import path from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

const rootEnvPath = path.resolve(process.cwd(), "..", "..", ".env");
try {
  process.loadEnvFile(rootEnvPath);
} catch {
  // .env may not exist in production environments
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(3200);
  console.log("Axiom Dashboard API running on http://localhost:3200");
}

void bootstrap();
