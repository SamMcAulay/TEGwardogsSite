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
        // A plain link: the file downloads, and prefetching it would log an export nobody asked for.
        <a href="/admin/links.csv" download className={buttonClass('secondary')}>
          Download linked accounts (CSV)
        </a>
      )}
    </div>
  );
}
