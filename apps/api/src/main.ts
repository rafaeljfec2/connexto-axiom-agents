import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(3200);
  console.log("Axiom Dashboard API running on http://localhost:3200");
}

void bootstrap();
