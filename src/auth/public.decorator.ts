import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Lets a route through the global AuthGuard without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
