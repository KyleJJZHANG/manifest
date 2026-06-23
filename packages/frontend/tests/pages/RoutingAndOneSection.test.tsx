import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';

const mockCreate = vi.fn();
const mockDelete = vi.fn();
const mockOverride = vi.fn();
vi.mock('../../src/services/api/header-tiers.js', () => ({
  createHeaderTier: (...a: unknown[]) => mockCreate(...a),
  deleteHeaderTier: (...a: unknown[]) => mockDelete(...a),
  overrideHeaderTier: (...a: unknown[]) => mockOverride(...a),
}));

// Stub the heavy model-picker card. Returns a real DOM node with buttons that
// invoke the section's callbacks so the section's handlers are covered.
vi.mock('../../src/components/HeaderTierCard.js', () => ({
  default: (
    props: Record<string, unknown> & {
      tier: { header_value: string };
      onOverride: (m: string, p: string, a?: string, label?: string) => void;
      onFallbacksUpdate: (fallbacks: string[], routes?: unknown) => void;
    },
  ) => {
    // Touch every passthrough prop so the section's JSX prop accessors run.
    void props.agentName;
    void props.models;
    void props.customProviders;
    void props.connectedProviders;
    void props.getModelParams;
    void props.setModelParams;
    const el = document.createElement('div');
    el.textContent = `CARD:${props.tier.header_value}`;
    const ov = document.createElement('button');
    ov.textContent = `override-${props.tier.header_value}`;
    ov.onclick = () => props.onOverride('m1', 'openai', 'api_key', 'lbl');
    const fb = document.createElement('button');
    fb.textContent = `fallback-${props.tier.header_value}`;
    fb.onclick = () =>
      props.onFallbacksUpdate([], [{ model: 'm1', provider: 'openai', authType: 'api_key' }]);
    const fbu = document.createElement('button');
    fbu.textContent = `fallback-undef-${props.tier.header_value}`;
    fbu.onclick = () => props.onFallbacksUpdate([], undefined);
    el.append(ov, fb, fbu);
    return el;
  },
}));

const mockToastError = vi.fn();
vi.mock('../../src/services/toast-store.js', () => ({
  toast: { error: (...a: unknown[]) => mockToastError(...a), success: vi.fn(), warning: vi.fn() },
}));

import RoutingAndOneSection from '../../src/pages/RoutingAndOneSection';
import type { HeaderTier } from '../../src/services/api/header-tiers';

function tier(value: string): HeaderTier {
  return {
    id: `ht-${value}`,
    agent_id: 'a',
    name: value,
    header_key: 'x-hycore-mode',
    header_value: value,
    badge_color: 'indigo',
    sort_order: 0,
    enabled: true,
    override_route: null,
    fallback_routes: null,
    created_at: '',
    updated_at: '',
  } as HeaderTier;
}

function renderSection(tiers: HeaderTier[] = []) {
  const refetch = vi.fn();
  const mutate = vi.fn();
  render(() => (
    <RoutingAndOneSection
      agentName={() => 'demo'}
      models={() => []}
      customProviders={() => []}
      connectedProviders={() => []}
      tiers={() => tiers}
      refetch={refetch}
      mutate={mutate}
    />
  ));
  return { refetch, mutate };
}

describe('RoutingAndOneSection', () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue(tier('x'));
    mockDelete.mockReset().mockResolvedValue(undefined);
    mockOverride.mockReset().mockResolvedValue(undefined);
    mockToastError.mockReset();
  });

  it('shows the three default harness stages with Set up when none configured', () => {
    renderSection([]);
    expect(screen.getByText('Chat')).toBeDefined();
    expect(screen.getByText('Agent')).toBeDefined();
    expect(screen.getByText('Workflow (frozen)')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Set up' })).toHaveLength(3);
  });

  it('renders a model card for a configured stage and no Set up for it', () => {
    renderSection([tier('chat')]);
    expect(screen.getByText('CARD:chat')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Set up' })).toHaveLength(2);
  });

  it('renders an extra (non-default) harness as a card', () => {
    renderSection([tier('eval')]);
    expect(screen.getByText('CARD:eval')).toBeDefined();
  });

  it('creates an x-hycore-mode tier when a stage is set up', async () => {
    const { refetch } = renderSection([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Set up' })[0]);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      'demo',
      expect.objectContaining({ header_key: 'x-hycore-mode', header_value: 'chat' }),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it('toasts when set up fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'));
    renderSection([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Set up' })[0]);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('boom'));
  });

  it('adds a custom harness with a normalized lowercase value', async () => {
    renderSection([]);
    fireEvent.input(screen.getByPlaceholderText(/New harness mode/), {
      target: { value: 'My Eval' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add harness' }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledWith(
      'demo',
      expect.objectContaining({ header_key: 'x-hycore-mode', header_value: 'my-eval' }),
    );
  });

  it('adds a harness on Enter', async () => {
    renderSection([]);
    const input = screen.getByPlaceholderText(/New harness mode/);
    fireEvent.input(input, { target: { value: 'Batch' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        'demo',
        expect.objectContaining({ header_value: 'batch' }),
      ),
    );
  });

  it('does not create on Enter when the value is empty', () => {
    renderSection([]);
    fireEvent.keyDown(screen.getByPlaceholderText(/New harness mode/), { key: 'Enter' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('disables Add harness until a value is entered', () => {
    renderSection([]);
    const btn = screen.getByRole('button', { name: 'Add harness' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('removes a configured harness', async () => {
    renderSection([tier('chat')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('demo', 'ht-chat'));
  });

  it('toasts when remove fails', async () => {
    mockDelete.mockRejectedValueOnce(new Error('nope'));
    renderSection([tier('chat')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('nope'));
  });

  it('assigns a model through the card override', async () => {
    const { refetch } = renderSection([tier('chat')]);
    fireEvent.click(screen.getByText('override-chat'));
    await waitFor(() =>
      expect(mockOverride).toHaveBeenCalledWith(
        'demo',
        'ht-chat',
        'm1',
        'openai',
        'api_key',
        'lbl',
      ),
    );
    expect(refetch).toHaveBeenCalled();
  });

  it('toasts when override fails', async () => {
    mockOverride.mockRejectedValueOnce(new Error('bad'));
    renderSection([tier('chat')]);
    fireEvent.click(screen.getByText('override-chat'));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('bad'));
  });

  it('optimistically mutates fallbacks when routes are known', () => {
    const { mutate, refetch } = renderSection([tier('chat')]);
    const applied: HeaderTier[] = [];
    mutate.mockImplementation(
      (fn: (prev: HeaderTier[] | undefined) => HeaderTier[] | undefined) => {
        // Exercise the updater with a matching + non-matching row, then with undefined.
        applied.push(...(fn([tier('chat'), tier('agent')]) ?? []));
        fn(undefined);
      },
    );
    fireEvent.click(screen.getByText('fallback-chat'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(applied.find((t) => t.id === 'ht-chat')?.fallback_routes).toEqual([
      { model: 'm1', provider: 'openai', authType: 'api_key' },
    ]);
  });

  it('refetches fallbacks when routes are unknown', () => {
    const { mutate, refetch } = renderSection([tier('chat')]);
    fireEvent.click(screen.getByText('fallback-undef-chat'));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('uses a fallback message when set up rejects without an Error', async () => {
    mockCreate.mockRejectedValueOnce('x');
    renderSection([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Set up' })[0]);
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to add harness'));
  });

  it('uses a fallback message when remove rejects without an Error', async () => {
    mockDelete.mockRejectedValueOnce('x');
    renderSection([tier('chat')]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to remove harness'));
  });

  it('uses a fallback message when override rejects without an Error', async () => {
    mockOverride.mockRejectedValueOnce('x');
    renderSection([tier('chat')]);
    fireEvent.click(screen.getByText('override-chat'));
    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to assign model'));
  });
});
