import type { Metadata } from 'next';
import { FriendsList } from '@/components/friends';
import { Container, PageHeader, Panel } from '@/components/ui';

export const metadata: Metadata = { title: 'Friends', description: 'The players you follow: who is online now, and where.' };

export default function FriendsPage() {
  return (
    <>
      <PageHeader
        eyebrow="You"
        title="Friends"
        description="Players you follow, and who's online now. Saved in this browser only, so there's nothing to sign in to; add friends from their profiles."
      />
      <Container className="mt-8">
        <Panel flush>
          <FriendsList />
        </Panel>
      </Container>
    </>
  );
}
