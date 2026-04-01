import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { ElasticsearchService } from './elasticsearch.service';
import { PostgresSearchService } from './postgres-search.service';
import { RoomsModule } from '../room/rooms.module';

@Module({
  imports: [RoomsModule],
  controllers: [SearchController],
  providers: [SearchService, ElasticsearchService, PostgresSearchService],
  exports: [SearchService, ElasticsearchService],
})
export class SearchModule {}
