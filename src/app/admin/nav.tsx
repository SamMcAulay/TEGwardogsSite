// The tabs across the staff pages. Shown only on them, so nothing public links here.
import { buttonClass, Segmented } from '@/components/ui';

export function AdminNav({ active }: { active: 'accounts' | 'teamkills' | 'health' }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Segmented
        label="Staff pages"
        prefetch={false}
        active={active}
        items={[
          { key: 'accounts', label: 'Accounts', href: '/admin' },
          { key: 'teamkills', label: 'Team kills', href: '/admin/teamkills' },
          { key: 'health', label: 'Health', href: '/admin/health' },
        ]}
      />
      {active === 'accounts' && (
        // Plain links: the file downloads, and prefetching it would log an export nobody asked for.
        <span className="flex flex-wrap items-center gap-3 text-sm">
          <a href="/admin/links.xlsx" download className={buttonClass('secondary')}>
            Download linked accounts (Excel)
          </a>
          <a
            href="/admin/links.csv"
            download
            className="link text-muted"
            title="For scripts; a spreadsheet rounds the long ids in a CSV"
          >
            CSV
          </a>
        </span>
      )}
    </div>
  );
}
