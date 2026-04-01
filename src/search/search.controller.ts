import {
  Controller,
  Get,
  Query,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchMessagesDto } from './dto/search-messages.dto';
import { SearchUsersDto } from './dto/search-users.dto';
import { SearchRoomsDto } from './dto/search-rooms.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { User } from '@prisma/client';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  // ─── Message search ───────────────────────────────────

  @Get('messages')
  @ApiOperation({
    summary: 'Full-text message search',
    description:
      'Searches messages the user has access to. Uses Elasticsearch with PostgreSQL tsvector fallback.',
  })
  @ApiResponse({ status: 200, description: 'Search results with highlighting' })
  searchMessages(@CurrentUser() user: User, @Query() dto: SearchMessagesDto) {
    return this.searchService.searchMessages(dto, user.id);
  }

  // ─── User autocomplete ────────────────────────────────

  @Get('users')
  @ApiOperation({
    summary: 'User search / autocomplete',
    description:
      'Search users by username or display name. Used for @mentions and DM creation.',
  })
  searchUsers(@Query() dto: SearchUsersDto) {
    return this.searchService.searchUsers(dto);
  }

  // ─── Room autocomplete ────────────────────────────────

  @Get('rooms')
  @ApiOperation({
    summary: 'Room search / autocomplete',
    description:
      'Search public rooms and private rooms the user is a member of.',
  })
  searchRooms(@CurrentUser() user: User, @Query() dto: SearchRoomsDto) {
    return this.searchService.searchRooms(dto, user.id);
  }

  // ─── Admin: trigger full reindex ──────────────────────

  @Post('reindex')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger full reindex from PostgreSQL into Elasticsearch',
    description: 'Admin utility. Safe to run while app is live.',
  })
  reindex() {
    return this.searchService.reindexAll();
  }
}
