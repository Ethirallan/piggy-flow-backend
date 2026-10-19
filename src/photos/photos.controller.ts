import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { inlineJpegDisposition } from './content-disposition.js';
import { PhotoResponseDto } from './dto/photo-response.dto.js';
import { PhotosService } from './photos.service.js';
import { RemoveUploadsInterceptor } from './remove-uploads.interceptor.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;

@ApiTags('bills')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('bills/:id/photos')
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST),
    RemoveUploadsInterceptor,
  )
  @ApiOperation({
    summary:
      'Add photos to a bill (re-encoded as JPEG; only the EXIF orientation is kept)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          maxItems: MAX_FILES_PER_REQUEST,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({ type: PhotoResponseDto, isArray: true })
  @ApiBadRequestResponse({
    description:
      'The id is not a UUID, no files, more than 10 files, an unsupported image, or more than 50 megapixels',
  })
  @ApiNotFoundResponse({
    description:
      'No such bill, or the current user is not a member of its account',
  })
  @ApiConflictResponse({
    description: 'The bill would have more than 10 photos',
  })
  @ApiPayloadTooLargeResponse({ description: 'A file is over 15 MB' })
  async add(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<PhotoResponseDto[]> {
    const added = await this.photos.add(
      auth.userId,
      id,
      (files ?? []).map((file) => ({
        path: file.path,
        originalName: file.originalname,
      })),
    );
    return added.map((photo) => PhotoResponseDto.from(photo));
  }

  @Get(':photoId')
  @ApiOperation({ summary: "Download a bill's photo (JPEG)" })
  @ApiProduces('image/jpeg')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiBadRequestResponse({ description: 'An id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      "No such bill or photo, or the current user is not a member of the bill's account",
  })
  async download(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { photo, file } = await this.photos.open(auth.userId, id, photoId);
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': String(file.size),
      'X-Content-Type-Options': 'nosniff',
      // A photo's bytes never change.
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': inlineJpegDisposition(photo.name),
    });
    return new StreamableFile(file.stream);
  }

  @Delete(':photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove a bill's photo" })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiBadRequestResponse({ description: 'An id is not a UUID' })
  @ApiNotFoundResponse({
    description:
      "No such bill or photo, or the current user is not a member of the bill's account",
  })
  remove(
    @CurrentUser() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
  ): Promise<void> {
    return this.photos.remove(auth.userId, id, photoId);
  }
}
