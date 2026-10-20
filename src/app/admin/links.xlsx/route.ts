// The linked accounts as an Excel file: Discord and Steam ids stay exact (as text).
import { downloadLinks } from '../download';

export const dynamic = 'force-dynamic';

export const GET = () => downloadLinks('xlsx');
