import { describe, it, expect } from 'vitest';
import { render } from '@solidjs/testing-library';
import { authBadgeFor, authLabel } from '../../src/components/AuthBadge';

describe('authLabel', () => {
  it('labels subscription auth', () => {
    expect(authLabel('subscription')).toBe('Subscription');
  });

  it('labels anything else (including null/undefined) as "API Key"', () => {
    expect(authLabel('api_key')).toBe('API Key');
    expect(authLabel(null)).toBe('API Key');
    expect(authLabel(undefined)).toBe('API Key');
    expect(authLabel('unknown')).toBe('API Key');
  });
});

describe('authBadgeFor', () => {
  it('returns null for unknown/missing auth types', () => {
    expect(authBadgeFor(null, 16)).toBeNull();
    expect(authBadgeFor(undefined, 16)).toBeNull();
    expect(authBadgeFor('bogus', 16)).toBeNull();
  });

  it('renders a subscription badge with the user icon and the correct aria label', () => {
    const { container } = render(() => authBadgeFor('subscription', 16));
    const badge = container.querySelector('.provider-auth-badge--sub');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('aria-label')).toBe('Subscription');
    expect(badge?.querySelector('svg')).not.toBeNull();
  });

  it('renders an api-key badge with the key icon and the correct aria label', () => {
    const { container } = render(() => authBadgeFor('api_key', 16));
    const badge = container.querySelector('.provider-auth-badge--key');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('aria-label')).toBe('API Key');
  });

  it('applies the overlay modifier for tiny sizes (<=8px)', () => {
    const { container } = render(() => authBadgeFor('api_key', 8));
    const badge = container.querySelector('.provider-auth-badge--overlay');
    expect(badge).not.toBeNull();
  });

  it('omits the overlay modifier for larger sizes', () => {
    const { container } = render(() => authBadgeFor('subscription', 24));
    expect(container.querySelector('.provider-auth-badge--overlay')).toBeNull();
  });
});
