import { useState, type ReactNode } from 'react';
import { img, type AssetKey } from '../../assets/manifest';
import { alt } from '../../assets/alt';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  Illustration,
  Screen,
  Segmented,
  Sheet,
  Skeleton,
  TabBar,
  toast,
  type ButtonSize,
  type ButtonVariant,
  type CardTone,
  type BadgeTone,
} from '../../ui';

// Dev-only component gallery (rendered from App.tsx behind import.meta.env.DEV). Not shipped in production builds.

const assetKeys = Object.keys(img) as AssetKey[];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-9">
      <h2 className="mb-3 text-[20px] font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-mutedText">{children}</div>;
}

export default function Gallery() {
  const [tone, setTone] = useState('playful');
  const [chips, setChips] = useState(['Bunny', 'Dinos', 'Twinkle Twinkle']);
  const [on, setOn] = useState<string[]>(['Mommy']);
  const [tab, setTab] = useState('sessions');
  const [sheet, setSheet] = useState(false);
  const [saving, setSaving] = useState(false);

  const variants: ButtonVariant[] = ['sun', 'coral', 'white', 'ghost'];
  const sizes: ButtonSize[] = ['lg', 'md', 'sm'];
  const cardTones: CardTone[] = ['white', 'sun', 'mint', 'sky', 'flag'];
  const badgeTones: BadgeTone[] = ['neutral', 'mint', 'sun', 'coral', 'sky', 'lilac', 'flag'];

  return (
    <div className="mx-auto h-full max-w-[1100px] overflow-y-auto px-4 pb-24 pt-6 text-ink" data-testid="gallery">
      <h1 className="mb-1 text-[28px] font-bold">EverThere design system</h1>
      <p className="mb-8 text-[15px] text-mutedText">Sunny &amp; Playful. Every component, variant and state, then every asset.</p>

      <Section title="Buttons">
        {sizes.map((size) => (
          <div key={size}>
            <Label>size {size}</Label>
            <div className="flex flex-wrap items-center gap-3 pb-1">
              {variants.map((v) => (
                <Button key={v} variant={v} size={size} icon={v === 'coral' ? '🎥' : undefined}>
                  {v}
                </Button>
              ))}
            </div>
          </div>
        ))}
        <Label>states</Label>
        <div className="flex flex-wrap items-center gap-3 pb-1">
          <Button loading={saving} onClick={() => { setSaving(true); setTimeout(() => setSaving(false), 1500); }}>
            {saving ? 'Saving' : 'Tap to save'}
          </Button>
          <Button loading>Loading</Button>
          <Button variant="coral" loading>Loading</Button>
          <Button disabled>Disabled</Button>
          <Button variant="white" disabled>Disabled</Button>
        </div>
        <Label>full width, with icon</Label>
        <div className="max-w-sm space-y-3 pb-1">
          <Button size="lg" fullWidth icon="👩‍👧">I&apos;m a parent</Button>
          <Button size="lg" fullWidth variant="white" icon="🏫">I&apos;m a daycare</Button>
        </div>
      </Section>

      <Section title="Chips">
        <div className="flex flex-wrap gap-x-2 gap-y-3">
          {['Mommy', 'Sunshine ☀️', 'Mia-bear'].map((c) => (
            <Chip key={c} selected={on.includes(c)} onClick={() => setOn((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}>
              {c}
            </Chip>
          ))}
          <Chip tone="add" onClick={() => toast.info('Add a nickname')}>+ add</Chip>
        </div>
        <Label>removable</Label>
        <div className="flex flex-wrap gap-x-2 gap-y-3">
          {chips.map((c) => (
            <Chip key={c} icon="🎵" onRemove={() => setChips((s) => s.filter((x) => x !== c))}>
              {c}
            </Chip>
          ))}
          {chips.length === 0 ? <button className="text-[14px] underline" onClick={() => setChips(['Bunny', 'Dinos', 'Twinkle Twinkle'])}>reset</button> : null}
        </div>
        <Label>tones</Label>
        <div className="flex flex-wrap gap-x-2 gap-y-3">
          <Chip tone="mint">✓ Looking at camera</Chip>
          <Chip tone="mint">✓ Waist up</Chip>
          <Chip tone="coral">🚫 Grandpa&apos;s hospital stay</Chip>
          <Chip tone="sky">Sky</Chip>
          <Chip tone="lilac">Lilac</Chip>
          <Chip selected>☀️ Great light</Chip>
        </div>
      </Section>

      <Section title="Cards">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {cardTones.map((t) => (
            <Card key={t} tone={t}>
              <div className="text-[17px] font-semibold">Mia felt better 💛</div>
              <div className="mt-1 text-[14px] text-ink/80">tone {t}. 4 min with Ms. Jess.</div>
            </Card>
          ))}
          <Card lift onClick={() => toast.success('Card tapped')}>
            <div className="text-[17px] font-semibold">Lifted and tappable</div>
            <div className="mt-1 text-[14px] text-mutedText">Press me</div>
          </Card>
        </div>
      </Section>

      <Section title="Segmented">
        <div className="max-w-sm">
          <Segmented
            aria-label="Tone"
            value={tone}
            onChange={setTone}
            options={[
              { value: 'calm', label: 'Calm', icon: '😌' },
              { value: 'playful', label: 'Playful', icon: '🎈' },
              { value: 'soothing', label: 'Soothing', icon: '🌙' },
            ]}
          />
        </div>
      </Section>

      <Section title="Badges and avatars">
        <div className="flex flex-wrap items-center gap-2">
          {badgeTones.map((t) => (
            <Badge key={t} tone={t}>{t}</Badge>
          ))}
          <Badge tone="mint" icon="✨">Mom ready</Badge>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Avatar emoji="👧🏼" name="Mia" size={40} />
          <Avatar emoji="👦🏾" name="Leo" size={56} ring />
          <Avatar name="Ava" size={56} />
          <Avatar src={img['blob.parent']} name="Parent" size={72} ring />
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Field label="Child's name" hint="First name is fine" placeholder="Mia" />
          <Field label="Invite code" error="That code doesn't look right. Try again?" defaultValue="AB12" />
          <Field label="A note for Mom" multiline placeholder="Went right down for nap!" className="sm:col-span-2" />
        </div>
      </Section>

      <Section title="Skeletons">
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2" aria-busy="true">
          <Card><div className="flex items-center gap-3"><Skeleton shape="circle" /><div className="flex-1"><Skeleton width="60%" /><div className="h-2" /><Skeleton width="40%" /></div></div></Card>
          <Skeleton shape="card" />
          <div><Skeleton shape="line" count={3} /></div>
          <div className="flex gap-2"><Skeleton shape="chip" /><Skeleton shape="chip" /><Skeleton shape="chip" /></div>
        </div>
      </Section>

      <Section title="Empty and error states">
        <div className="grid gap-4 md:grid-cols-3">
          <Card><EmptyState asset="empty.noSessions" title="No chats yet" body="When your little one talks to your avatar, the story shows up here." action={{ label: 'Try a test call', onClick: () => toast.info('Calling...') }} /></Card>
          <Card><EmptyState asset="empty.noChildren" title="Add your first little one" body="It takes about two minutes." action={<Button variant="coral">Add a child</Button>} /></Card>
          <Card><ErrorState onRetry={() => toast.success('Fresh start!')} /></Card>
          <Card><ErrorState offline onRetry={() => toast.info('Still offline')} /></Card>
          <Card><EmptyState asset="empty.noAlerts" title="All calm" body="Nothing to flag. We will tell you the moment something comes up." /></Card>
          <Card><EmptyState asset="empty.resting" title="Avatars are resting" body="Back soon." /></Card>
        </div>
      </Section>

      <Section title="Toasts and sheet">
        <div className="flex flex-wrap gap-3">
          <Button variant="white" onClick={() => toast.success('Saved! Mia will love it.')}>Success</Button>
          <Button variant="white" onClick={() => toast.error("We couldn't save that. Try again?")}>Error</Button>
          <Button variant="white" onClick={() => toast.info('Heads up: setup takes a minute')}>Info</Button>
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
        </div>
        <Sheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Add a favorite"
          footer={<Button fullWidth size="lg" onClick={() => { setSheet(false); toast.success('Added!'); }}>Add it</Button>}
        >
          <p className="mb-3 text-[15px] text-mutedText">Drag the handle down, press Esc, or tap outside to close.</p>
          <Field label="Favorite thing" placeholder="Bunny" />
          <div className="mt-3 flex flex-wrap gap-x-2 gap-y-3">
            {['🐰 Bunny', '🦕 Dinos', '🎵 Twinkle'].map((c) => <Chip key={c}>{c}</Chip>)}
          </div>
        </Sheet>
      </Section>

      <Section title="Screen, TopBar and TabBar">
        <div className="flex flex-wrap gap-6">
          <div className="h-[560px] w-[300px] shrink-0 overflow-hidden rounded-[34px] border-[8px] border-[#111] shadow-xl">
            <Screen
              bg="sunGradient"
              title="Mia's comfort plan"
              back={() => toast.info('Back')}
              actions={<button aria-label="Save" className="grid h-11 w-11 place-items-center text-[20px]">💾</button>}
              footer={<Button variant="coral" size="lg" fullWidth icon="🎥">Try a test call</Button>}
            >
              <h2 className="mb-2 text-[20px] font-semibold leading-tight">How do you comfort Mia?</h2>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-mutedText">Tone</div>
              <Segmented className="mt-1.5" aria-label="Tone" value={tone} onChange={setTone} options={[{ value: 'calm', label: 'Calm' }, { value: 'playful', label: 'Playful' }, { value: 'soothing', label: 'Soothing' }]} />
              <div className="mt-4 rounded-[18px] bg-lilac px-3 py-2.5 text-[13px] leading-relaxed">🔒 <b>Always on:</b> never promises pickup times · no secrets · never scolds · no medical advice</div>
            </Screen>
          </div>
          <div className="h-[560px] w-[300px] shrink-0 overflow-hidden rounded-[34px] border-[8px] border-[#111] shadow-xl">
            <Screen
              title="Sessions"
              footerPadded={false}
              footer={
                <TabBar
                  value={tab}
                  onChange={setTab}
                  items={[
                    { key: 'home', label: 'Home', icon: '🏠' },
                    { key: 'avatar', label: 'My Avatar', icon: '🪞' },
                    { key: 'sessions', label: 'Sessions', icon: '💬', badge: 2 },
                    { key: 'caregivers', label: 'Caregivers', icon: '👥' },
                  ]}
                />
              }
            >
              <Card tone="mint" className="mt-1">
                <div className="flex items-center justify-between"><div className="text-[17px] font-semibold">Mia felt better 💛</div><span className="rounded-full bg-white px-2 py-0.5 text-[13px]">😢 → 😊</span></div>
                <div className="mt-1 text-[13px] text-mintInk">4 min · Upset before nap · with Ms. Jess</div>
              </Card>
              <div className="mt-3 rounded-[16px] border-2 border-coral bg-flag px-3 py-2.5 text-[13px]">⚑ <b>Heads up:</b> Mia said her knee hurts from the slide. It&apos;s a small scrape. 🩹</div>
              <div className="mt-3 ml-auto w-fit max-w-[82%] rounded-[16px] rounded-br-[4px] bg-sky px-3 py-2 text-[13px]">I miss you mommy</div>
            </Screen>
          </div>
        </div>
      </Section>

      <Section title="Assets at 64px">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-3">
          {assetKeys.map((k) => (
            <figure key={k} className="m-0 flex flex-col items-center rounded-card border-2 border-line bg-white p-2 text-center">
              <Illustration asset={k} size={64} alt={alt[k] === '' ? '' : k} />
              <figcaption className="mt-1 break-all text-[10px] leading-tight text-mutedText">{k}</figcaption>
            </figure>
          ))}
        </div>
      </Section>

      <Section title="Assets at 160px">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          {assetKeys.map((k) => (
            <figure key={k} className="m-0 flex flex-col items-center rounded-card border-2 border-line bg-white p-3 text-center">
              <Illustration asset={k} size={160} alt={alt[k] === '' ? '' : k} />
              <figcaption className="mt-1.5 break-all text-[11px] leading-tight text-mutedText">{k}</figcaption>
            </figure>
          ))}
        </div>
      </Section>
    </div>
  );
}
