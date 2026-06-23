import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@solidjs/testing-library';
import RoutingTabs from '../../src/components/RoutingTabs';

function children() {
  return {
    default: <div data-testid="default-content">Default content</div>,
    specificity: <div data-testid="specificity-content">Specificity content</div>,
    andone: <div data-testid="andone-content">AndONE content</div>,
    custom: <div data-testid="custom-content">Custom content</div>,
  };
}

function renderTabs(
  overrides: Partial<{
    specificityEnabled: boolean;
    andoneEnabled: boolean;
    customEnabled: boolean;
  }> = {},
) {
  return render(() => (
    <RoutingTabs
      specificityEnabled={() => overrides.specificityEnabled ?? false}
      andoneEnabled={() => overrides.andoneEnabled ?? false}
      customEnabled={() => overrides.customEnabled ?? false}
    >
      {children()}
    </RoutingTabs>
  ));
}

describe('RoutingTabs', () => {
  it('renders all four tab labels', () => {
    renderTabs();
    expect(screen.getByRole('tab', { name: /Default/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Task-specific/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /AndONE-Specific/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: /Custom/ })).toBeDefined();
  });

  it('renders tablist with aria-label', () => {
    renderTabs();
    expect(screen.getByRole('tablist', { name: 'Routing layers' })).toBeDefined();
  });

  it('shows default content by default', () => {
    renderTabs();
    expect(screen.getByTestId('default-content')).toBeDefined();
    expect(screen.queryByTestId('specificity-content')).toBeNull();
    expect(screen.queryByTestId('andone-content')).toBeNull();
    expect(screen.queryByTestId('custom-content')).toBeNull();
  });

  it('switches to specificity tab on click', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('tab', { name: /Task-specific/ }));
    expect(screen.queryByTestId('default-content')).toBeNull();
    expect(screen.getByTestId('specificity-content')).toBeDefined();
  });

  it('switches to AndONE-Specific tab on click', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('tab', { name: /AndONE-Specific/ }));
    expect(screen.queryByTestId('default-content')).toBeNull();
    expect(screen.getByTestId('andone-content')).toBeDefined();
  });

  it('switches to custom tab on click', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('tab', { name: /Custom/ }));
    expect(screen.queryByTestId('default-content')).toBeNull();
    expect(screen.getByTestId('custom-content')).toBeDefined();
  });

  it('marks the active tab with aria-selected=true', () => {
    renderTabs();
    const defaultTab = screen.getByRole('tab', { name: /Default/ });
    expect(defaultTab.getAttribute('aria-selected')).toBe('true');

    const specificityTab = screen.getByRole('tab', { name: /Task-specific/ });
    expect(specificityTab.getAttribute('aria-selected')).toBe('false');
  });

  it('updates aria-selected on tab switch', () => {
    renderTabs();
    fireEvent.click(screen.getByRole('tab', { name: /Task-specific/ }));

    expect(screen.getByRole('tab', { name: /Default/ }).getAttribute('aria-selected')).toBe(
      'false',
    );
    expect(screen.getByRole('tab', { name: /Task-specific/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('renders tabpanel with correct role', () => {
    renderTabs();
    expect(screen.getByRole('tabpanel')).toBeDefined();
  });

  it('shows green dot for enabled layers and gray for disabled', () => {
    const { container } = renderTabs({
      specificityEnabled: false,
      andoneEnabled: true,
      customEnabled: true,
    });
    const dots = container.querySelectorAll('.routing-tabs__dot');
    // Default (on), specificity (off), andone (on), custom (on)
    expect(dots[0].classList.contains('routing-tabs__dot--on')).toBe(true);
    expect(dots[1].classList.contains('routing-tabs__dot--off')).toBe(true);
    expect(dots[2].classList.contains('routing-tabs__dot--on')).toBe(true);
    expect(dots[3].classList.contains('routing-tabs__dot--on')).toBe(true);
  });

  it('Default dot is always on; specificity, andone and custom are off by default', () => {
    const { container } = renderTabs();
    const dots = container.querySelectorAll('.routing-tabs__dot');
    expect(dots.length).toBe(4);
    expect(dots[0].classList.contains('routing-tabs__dot--on')).toBe(true);
    expect(dots[1].classList.contains('routing-tabs__dot--off')).toBe(true);
    expect(dots[2].classList.contains('routing-tabs__dot--off')).toBe(true);
    expect(dots[3].classList.contains('routing-tabs__dot--off')).toBe(true);
  });

  it('applies active class to selected tab', () => {
    const { container } = renderTabs();
    const tabs = container.querySelectorAll('.panel__tab');
    expect(tabs[0].classList.contains('panel__tab--active')).toBe(true);
    expect(tabs[1].classList.contains('panel__tab--active')).toBe(false);
  });

  /* ---- Pipeline help modal ---- */

  it('accepts pipelineHelp prop without rendering help button or modal', () => {
    render(() => (
      <RoutingTabs
        specificityEnabled={() => false}
        andoneEnabled={() => false}
        customEnabled={() => false}
        pipelineHelp={() => <div data-testid="help-content">Help text</div>}
      >
        {children()}
      </RoutingTabs>
    ));
    // Help button and modal are now managed by the parent (Routing.tsx)
    expect(screen.queryByLabelText('How routing works')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not show help button when pipelineHelp returns null', () => {
    render(() => (
      <RoutingTabs
        specificityEnabled={() => false}
        andoneEnabled={() => false}
        customEnabled={() => false}
        pipelineHelp={() => null}
      >
        {children()}
      </RoutingTabs>
    ));
    expect(screen.queryByLabelText('How routing works')).toBeNull();
  });

  it('renders headerRight slot when provided', () => {
    render(() => (
      <RoutingTabs
        specificityEnabled={() => false}
        andoneEnabled={() => false}
        customEnabled={() => false}
        headerRight={<div data-testid="header-right-content">Right content</div>}
      >
        {children()}
      </RoutingTabs>
    ));
    expect(screen.getByTestId('header-right-content')).toBeDefined();
  });

  it('does not render headerRight wrapper when no slot is provided', () => {
    const { container } = render(() => (
      <RoutingTabs
        specificityEnabled={() => false}
        andoneEnabled={() => false}
        customEnabled={() => false}
      >
        {children()}
      </RoutingTabs>
    ));
    expect(container.querySelector('.routing-tabs__header-right')).toBeNull();
  });

  it('accepts onShowHelp prop for parent-managed help modal', () => {
    const onShowHelp = vi.fn();
    render(() => (
      <RoutingTabs
        specificityEnabled={() => false}
        andoneEnabled={() => false}
        customEnabled={() => false}
        onShowHelp={onShowHelp}
      >
        {children()}
      </RoutingTabs>
    ));
    // The component accepts the prop but does not render a help button itself
    expect(screen.queryByLabelText('How routing works')).toBeNull();
  });

  it('does not render a help modal internally even with pipelineHelp', () => {
    render(() => (
      <RoutingTabs
        specificityEnabled={() => false}
        andoneEnabled={() => false}
        customEnabled={() => false}
        pipelineHelp={() => <div>Help</div>}
      >
        {children()}
      </RoutingTabs>
    ));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
