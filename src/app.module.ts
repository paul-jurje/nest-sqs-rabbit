import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { QueueModule } from './queue/queue.module';
import { QueueController } from './queue/queue.controller';

@Module({
  imports: [QueueModule.register()],
  controllers: [AppController, QueueController],
  providers: [AppService],
})
export class AppModule {}
