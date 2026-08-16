import { NextRequest, NextResponse } from 'next/server';
import { searchOmkarProducts } from '@/lib/omkar-search';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('query')?.trim() || '';
    const page = Number(request.nextUrl.searchParams.get('page') || '1');

    if (!query) {
      return NextResponse.json(
        { ok: false, error: 'Informe o parâmetro query.' },
        { status: 400 }
      );
    }

    const results = await searchOmkarProducts(query, page);
    return NextResponse.json({ ok: true, ...results });
  } catch (error) {
    console.error('AliExpress search failed:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha na busca.',
      },
      { status: 502 }
    );
  }
}
