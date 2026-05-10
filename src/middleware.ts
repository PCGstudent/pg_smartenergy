import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static (build assets)
     *  - _next/image (Next image optimizer)
     *  - favicon, robots, sitemap, static images
     *  - /api/inngest (signed by Inngest, must hit handler unmodified)
     *  - /api/ingest (server-to-server with bearer auth)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|api/inngest|api/ingest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
