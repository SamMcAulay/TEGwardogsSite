// For scripts and Bulkhead's priority queue; staff opening it in a spreadsheet want links.xlsx.
import { downloadLinks } from '../download';

export const dynamic = 'force-dynamic';

export const GET = () => downloadLinks('csv');
