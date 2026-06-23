import { createSignal, For, Show, type Accessor, type Component } from 'solid-js';
import HeaderTierCard from '../components/HeaderTierCard.js';
import {
  createHeaderTier,
  deleteHeaderTier,
  overrideHeaderTier,
  type HeaderTier,
} from '../services/api/header-tiers.js';
import type {
  AuthType,
  AvailableModel,
  CustomProviderData,
  ModelRoute,
  RequestParamDefaults,
  RoutingProvider,
} from '../services/api.js';
import { ANDONE_HEADER_KEY, ANDONE_STAGES } from '../services/andone.js';
import { toast } from '../services/toast-store.js';
import { TIER_COLORS, type TierColor } from 'manifest-shared';

export interface RoutingAndOneSectionProps {
  agentName: Accessor<string>;
  models: Accessor<AvailableModel[]>;
  customProviders: Accessor<CustomProviderData[]>;
  connectedProviders: Accessor<RoutingProvider[]>;
  /** Header tiers already filtered to ANDONE_HEADER_KEY by the parent. */
  tiers: Accessor<HeaderTier[]>;
  refetch: () => void;
  mutate: (mutator: (prev: HeaderTier[] | undefined) => HeaderTier[] | undefined) => void;
  getModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
  ) => RequestParamDefaults | null;
  setModelParams?: (
    scope: string,
    provider: string,
    authType: AuthType,
    model: string,
    params: RequestParamDefaults | null,
  ) => Promise<unknown>;
}

const colorForIndex = (i: number): TierColor => TIER_COLORS[i % TIER_COLORS.length] as TierColor;

// A harness value is any lowercase [a-z0-9-] token the client sends as
// `x-hycore-mode`. Mirrors the backend header_key rule so a bad value is
// rejected here instead of round-tripping to a 400.
function normalizeHarness(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

const RoutingAndOneSection: Component<RoutingAndOneSectionProps> = (props) => {
  const [creating, setCreating] = createSignal<string | null>(null);
  const [newHarness, setNewHarness] = createSignal('');

  const tierFor = (value: string): HeaderTier | undefined =>
    props.tiers().find((t) => t.header_value === value);

  // Stages = the built-in defaults, plus any extra harness the user added that
  // isn't one of the defaults (rendered after the defaults, in created order).
  const extraTiers = (): HeaderTier[] =>
    props.tiers().filter((t) => !ANDONE_STAGES.some((s) => s.id === t.header_value));

  const handleOverride = async (
    id: string,
    model: string,
    provider: string,
    authType?: AuthType,
    providerKeyLabel?: string,
  ): Promise<void> => {
    try {
      await overrideHeaderTier(props.agentName(), id, model, provider, authType, providerKeyLabel);
      props.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign model');
    }
  };

  const applyFallbackUpdate = (tierId: string, updatedRoutes: ModelRoute[] | null | undefined) => {
    if (updatedRoutes === undefined) {
      props.refetch();
      return;
    }
    props.mutate((prev) =>
      prev?.map((t) => (t.id === tierId ? { ...t, fallback_routes: updatedRoutes } : t)),
    );
  };

  const handleRemove = async (id: string): Promise<void> => {
    try {
      await deleteHeaderTier(props.agentName(), id);
      props.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove harness');
    }
  };

  const handleCreate = async (name: string, value: string): Promise<void> => {
    const header_value = normalizeHarness(value);
    if (!header_value) return;
    setCreating(header_value);
    try {
      await createHeaderTier(props.agentName(), {
        name: name.slice(0, 32),
        header_key: ANDONE_HEADER_KEY,
        header_value,
        badge_color: colorForIndex(props.tiers().length),
      });
      props.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add harness');
    } finally {
      setCreating(null);
    }
  };

  const card = (tier: HeaderTier) => (
    <div class="andone-stage-card">
      <HeaderTierCard
        agentName={props.agentName()}
        tier={tier}
        models={props.models()}
        customProviders={props.customProviders()}
        connectedProviders={props.connectedProviders()}
        onOverride={(m, p, a, label) => handleOverride(tier.id, m, p, a, label)}
        onFallbacksUpdate={(_fallbacks, routes) => applyFallbackUpdate(tier.id, routes)}
        getModelParams={props.getModelParams}
        setModelParams={props.setModelParams}
      />
      <button
        type="button"
        class="btn btn--ghost btn--sm"
        style="margin-top: 6px;"
        onClick={() => handleRemove(tier.id)}
      >
        Remove
      </button>
    </div>
  );

  return (
    <div>
      <div class="routing-section__header" style="margin-bottom: 16px;">
        <div>
          <span class="routing-section__subtitle">
            Route each AndONE harness mode to its own model. The client sends{' '}
            <code>{ANDONE_HEADER_KEY}: &lt;mode&gt;</code>; matches force-route before all other
            routing. Add a harness to onboard a new mode in one step.
          </span>
        </div>
      </div>

      <div class="routing-cards header-tier-list">
        <For each={ANDONE_STAGES}>
          {(stage) => {
            const tier = () => tierFor(stage.id);
            return (
              <Show
                when={tier()}
                keyed
                fallback={
                  <div
                    class="andone-stage-row"
                    style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border: 1px solid rgba(0,0,0,0.08); border-radius: 10px;"
                  >
                    <div>
                      <div style="font-weight: 600;">{stage.label}</div>
                      <div class="routing-section__subtitle" style="margin: 0;">
                        {stage.desc}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn btn--primary btn--sm"
                      disabled={creating() === stage.id}
                      onClick={() => handleCreate(stage.label, stage.id)}
                    >
                      {creating() === stage.id ? 'Adding…' : 'Set up'}
                    </button>
                  </div>
                }
              >
                {(t) => card(t)}
              </Show>
            );
          }}
        </For>

        <For each={extraTiers()}>{(tier) => card(tier)}</For>
      </div>

      <div class="andone-add-harness" style="display: flex; gap: 8px; margin-top: 16px;">
        <input
          type="text"
          class="input"
          placeholder="New harness mode (e.g. eval, batch)"
          value={newHarness()}
          onInput={(e) => setNewHarness(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleCreate(newHarness(), newHarness()).then(() => setNewHarness(''));
            }
          }}
        />
        <button
          type="button"
          class="btn btn--outline btn--sm"
          disabled={!normalizeHarness(newHarness()) || creating() !== null}
          onClick={() =>
            void handleCreate(newHarness(), newHarness()).then(() => setNewHarness(''))
          }
        >
          Add harness
        </button>
      </div>
    </div>
  );
};

export default RoutingAndOneSection;
