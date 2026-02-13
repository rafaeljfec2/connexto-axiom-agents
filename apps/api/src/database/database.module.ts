import { Module, Global } from "@nestjs/common";
import { DATABASE_TOKEN, databaseProvider } from "./database.provider";

@Global()
@Module({
  providers: [databaseProvider],
  exports: [DATABASE_TOKEN],
})
export class DatabaseModule {}
