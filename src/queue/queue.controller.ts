import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PublishOptions, QueueProvider } from './queue.types';

type PublishBody = PublishOptions & { payload: unknown };
type PullBody = { maxMessages?: number };
type AckBody = { receipt: string };

@Controller('queues')
export class QueueController {
  constructor(private readonly queueService: QueueService) { }

  @Get('providers')
  providers(): { providers: QueueProvider[], activeProvider: QueueProvider } {
    return { providers: this.queueService.getAvailableProviders(), activeProvider: (process.env.QUEUE_PROVIDER ?? 'memory') as QueueProvider };
  }

  @Post('/:provider/:queue/publish')
  publish(
    @Param('queue') queue: string,
    @Param('provider') provider: string,
    @Body() body: PublishBody,
  ): Promise<unknown> {
    const { payload, ...options } = body;
    return this.queueService.publish(provider as QueueProvider, queue, payload, options);
  }

  @Post(':provider/:queue/pull')
  pull(
    @Param('queue') queue: string,
    @Param('provider') provider: string,
    @Body() body: PullBody,
  ): Promise<unknown> {
    return this.queueService.pull(provider as QueueProvider, queue, body?.maxMessages);
  }

  @Post(':provider/:queue/ack')
  ack(
    @Param('queue') queue: string,
    @Param('provider') provider: string,
    @Body() body: AckBody,
  ): Promise<void> {
    return this.queueService.ack(provider as QueueProvider, queue, body.receipt);
  }
}
