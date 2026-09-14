/**
 * Tavily plugin card, browser half — one card registered into the settings
 * shell's `settings.plugin.item` slot, bound to the `web-search-tavily`
 * namespace the Host plugin registers through the settings seam.
 *
 * The key is the one control that does not live in the section: the card
 * learns only whether one is configured and writes it through the credentials
 * domain, addressed by the reference the section names.
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's ctx.settingsScope Context merge. Cross-plugin
// collaboration goes through the service, never a value import (client bundle
// purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { TavilyCard } from './TavilyCard.tsx'

import { TAVILY_NS, TavilyCardController, type TavilyClientContext } from './tavily-card-controller.ts'
import { en, zh } from './locales.ts'
import { injectCardStyles } from './styles.ts'

/** Dictionary namespace owned by this plugin's card. */
const NS = 'settings.plugins.tavily'

/** Card identity: the current settings-plugin slot is keyed by namespace. */
const CARD_KEY = 'web-search-tavily'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'remote', 'settingsScope']

/**
 * Mount the Tavily plugin card into the plugin configuration section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  // Service resolution (fiber inject waiting): the client runner creates
  // the entry as ctx.plugin({ inject, apply }), so apply only runs after
  // the declared services are available. Prefer the new-runtime direct
  // property with a ctx.get fallback for older runtimes, and fail loud —
  // a silent no-op would blank the whole card (same class as
  // dsh-plugin-tts@a00b357, where slots was unavailable at apply time).
  const ctxAny = ctx as unknown as Record<string, any>
  const viaGet = (serviceName: string): any => {
    if (typeof ctxAny.get !== 'function') return undefined
    try {
      return ctxAny.get(serviceName)
    } catch {
      return undefined
    }
  }
  const slots = ctxAny.slots ?? viaGet('slots')
  if (!slots) throw new Error('[dsh-plugin-tavily] slots service unavailable')
  const locale = ctxAny.locale ?? viaGet('locale')
  if (!locale) throw new Error('[dsh-plugin-tavily] locale service unavailable')
  const remote = ctxAny.remote ?? viaGet('remote')
  if (!remote) throw new Error('[dsh-plugin-tavily] remote service unavailable')
  const settingsScope = ctxAny.settingsScope ?? viaGet('settingsScope')
  if (!settingsScope) throw new Error('[dsh-plugin-tavily] settingsScope service unavailable')

  ctx.effect(() => locale.register(NS, { zh, en }), 'web-search-tavily: card dictionaries')
  ctx.effect(() => injectCardStyles(), 'web-search-tavily: card styles')

  const controller = new TavilyCardController(settingsScope.bind({ namespace: TAVILY_NS }), ctx as TavilyClientContext)

  // The credential a card reports is not part of any settings section, so its
  // scope publishes nothing when one is written. This is the only signal that
  // a key written on another surface reached the Host.
  ctx.effect(
    () => remote.$on('credentials/reference-updated', (ref: string) => { controller.refreshCredential(ref) }),
    'web-search-tavily: credential invalidations',
  )

  // Harness 0.1.2 exposes this as a keyed slot. The namespace is the
  // stable identity used by the settings-plugin surface to render this card.
  const cardOptions = {
    name: 'settings.plugin.item',
    key: CARD_KEY,
    locale: NS,
    inject: () => controller.inject(),
  } as const
  ctx.effect(
    () =>
      slots.inject('settings.plugin.item', function* () {
        yield slots.register(cardOptions, TavilyCard)
      }),
    'web-search-tavily: settings card',
  )
}
