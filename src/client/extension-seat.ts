/**
 * The skin page's single settings seat.
 *
 * New family shells mount installed-item pages inside the Web Extensions
 * section through a keyed child slot. Older shells expose only the original
 * first-level settings section. The family service, rather than a slot-declaration
 * probe, identifies the new shell; slot declarations only control when a move can
 * be made. The contribution follows slots/changed so late loading, declaration
 * collapse and unloading never leave it mounted in two places or stranded in a
 * collapsed seat.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SkinCenterInjected, SkinCenterSection } from './SkinCenter.tsx'

/** The consolidated family page's child seat. */
export const WEB_UI_EXTENSION_SLOT = 'web-ui.extension' as const
/** The pre-consolidation first-level settings seat. */
export const LEGACY_SETTINGS_SLOT = 'settings.section' as const
/** This package's stable key in either seat. */
export const SKIN_CENTER_ENTRY_KEY = 'skin-center' as const

type SkinCenterSeat = typeof WEB_UI_EXTENSION_SLOT | typeof LEGACY_SETTINGS_SLOT

/** Optional service published by the family Web Extensions parent. */
export interface WebUiExtensions {
  /** Open one installed-item page by key; deep-link owners call this, not the skin page. */
  open(id: string): boolean
  /** The parent first-level section id, retained for deep-link compatibility. */
  readonly sectionId: string
  /** The parent section's localized label. */
  label(): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only while the consolidated Web Extensions parent is available. */
    webUiExtensions?: WebUiExtensions
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One keyed installed-item page inside the family Web Extensions section. */
    'web-ui.extension': {
      kind: 'keyed'
      scope: 'root'
      owner: SettingsSectionOwnerProps
    }
  }
}

/** Everything about the contribution that is independent of its seat. */
export interface SkinCenterSeatRegistration {
  /** Business face shared by the component in either seat. */
  inject: () => SkinCenterInjected
  /** The legacy first-level navigation label. */
  label: () => string
  /** The same component mounts in either seat; no view-state owner changes. */
  component: typeof SkinCenterSection
}

interface LiveRegistration {
  seat: SkinCenterSeat
  dispose: () => void
}

/** Report a refused move without disabling the rest of the skin runtime. */
function warnRegistration(seat: SkinCenterSeat, error: unknown): void {
  try {
    console.warn(`[skin-center] settings registration into "${seat}" was refused`, error)
  } catch {
    // A host with a restricted console must not lose the remaining entry too.
  }
}

/**
 * Install the one live skin-page registration and follow the parent lifecycle.
 * @param ctx - browser plugin context.
 * @param registration - seat-independent component, locale and business face.
 * @returns cleanup for the listener and whichever registration is currently live.
 */
export function installSkinCenterSeat(
  ctx: ClientContext,
  registration: SkinCenterSeatRegistration,
): () => void {
  let current: LiveRegistration | undefined
  let reconciling = false

  const familyAvailable = (): boolean => {
    try {
      return typeof ctx.get('webUiExtensions')?.open === 'function'
    } catch {
      return false
    }
  }

  const register = (seat: SkinCenterSeat): (() => void) => {
    if (seat === WEB_UI_EXTENSION_SLOT) {
      return ctx.slots.register({
        name: WEB_UI_EXTENSION_SLOT,
        key: SKIN_CENTER_ENTRY_KEY,
        locale: 'skinCenter',
        inject: registration.inject,
      }, registration.component)
    }
    return ctx.slots.register({
      name: LEGACY_SETTINGS_SLOT,
      id: SKIN_CENTER_ENTRY_KEY,
      order: 120,
      label: registration.label,
      locale: 'skinCenter',
      inject: registration.inject,
    }, registration.component)
  }

  const hasRegistration = (seat: SkinCenterSeat): boolean => {
    const identity = seat === WEB_UI_EXTENSION_SLOT ? 'key' : 'id'
    return ctx.slots.entries(seat).some(entry =>
      entry.component === registration.component && entry.options[identity] === SKIN_CENTER_ENTRY_KEY)
  }

  const reconcileOnce = (): void => {
    const target = familyAvailable() ? WEB_UI_EXTENSION_SLOT : LEGACY_SETTINGS_SLOT
    if (current?.seat === target && hasRegistration(target)) return
    // Keep the old entry until the replacement declaration exists. This is a
    // readiness wait only; the family service remains the deployment verdict.
    if (ctx.slots.spec(target) === undefined) return

    const previous = current
    current = undefined
    previous?.dispose()
    try {
      current = { seat: target, dispose: register(target) }
    } catch (error) {
      // A refused replacement must not turn a working old-host entry into no
      // entry at all. Re-register the previous seat when its owner is still live.
      if (previous !== undefined && ctx.slots.spec(previous.seat) !== undefined) {
        try {
          current = { seat: previous.seat, dispose: register(previous.seat) }
        } catch (restoreError) {
          warnRegistration(previous.seat, restoreError)
        }
      }
      warnRegistration(target, error)
    }
  }

  const reconcile = (): void => {
    // Slot disposal and registration both emit synchronously. Ignore that
    // self-emission while a move is in flight: re-entry could duplicate a key,
    // and a refused target would otherwise be retried forever in one pass.
    if (reconciling) return
    reconciling = true
    try {
      reconcileOnce()
    } finally {
      reconciling = false
    }
  }

  const stopListening = ctx.on('slots/changed', reconcile) as unknown
  reconcile()
  return () => {
    if (typeof stopListening === 'function') stopListening()
    current?.dispose()
    current = undefined
  }
}
