/* Interface preferences, applied on every page.
 *
 * These are per-device by nature - there is no column for "how big does this
 * person like their text" and syncing it would be odd anyway - so they live in
 * localStorage and this file re-applies them before the page is interacted
 * with. Loaded first, ahead of api.js, so the adjustment happens once rather
 * than as a visible reflow.
 *
 * Everything here works by generating a stylesheet that overrides the Tailwind
 * utilities the design system actually uses. That is deliberately narrow: it
 * covers the spacing and accent classes these pages use, and nothing else.
 */
window.VH = window.VH || {};

(function (VH) {
  'use strict';

  var KEY = 'vinhack.prefs';
  var STYLE_ID = 'vh-prefs-style';

  var SCALES = [0.85, 1, 1.15, 1.3];
  var DENSITY = { compact: 0.8, standard: 1, spacious: 1.25 };

  /* The spacing scale out of the design system, in rem. */
  var SPACING = {
    'space-xs': 0.25, 'space-sm': 0.5, 'space-md': 1, 'space-lg': 1.5,
    'space-xl': 2, 'space-2xl': 3, 'gutter': 1.5, 'margin': 2
  };
  var SPACING_PROPS = {
    p: ['padding'], px: ['padding-left', 'padding-right'], py: ['padding-top', 'padding-bottom'],
    pt: ['padding-top'], pr: ['padding-right'], pb: ['padding-bottom'], pl: ['padding-left'],
    m: ['margin'], mx: ['margin-left', 'margin-right'], my: ['margin-top', 'margin-bottom'],
    mt: ['margin-top'], mr: ['margin-right'], mb: ['margin-bottom'], ml: ['margin-left'],
    gap: ['gap'], 'gap-x': ['column-gap'], 'gap-y': ['row-gap']
  };

  /* Only the accent tokens; the neutral surfaces stay put. */
  var ACCENTS = {
    emerald: { primary: '#4edea3', container: '#10b981', onPrimary: '#003824', dim: '#4edea3' },
    cyan: { primary: '#4fdbc8', container: '#04b4a2', onPrimary: '#00201c', dim: '#71f8e4' },
    sapphire: { primary: '#8fb8ff', container: '#3b6fd4', onPrimary: '#001b3d', dim: '#b3d0ff' },
    violet: { primary: '#d0bcff', container: '#b090ff', onPrimary: '#23005c', dim: '#e9ddff' }
  };

  /* OLED darkens the surface ramp to true black without touching the accents. */
  var OLED = {
    'bg-surface': '#000000', 'bg-background': '#000000', 'bg-surface-dim': '#000000',
    'bg-surface-container-lowest': '#000000', 'bg-surface-container-low': '#0a0a0c',
    'bg-surface-container': '#101013', 'bg-surface-container-high': '#17171b',
    'bg-surface-container-highest': '#1f1f24'
  };

  var DEFAULTS = { scale: 1, density: 'standard', theme: 'obsidian', accent: 'emerald' };

  VH.prefs = {
    read: function () {
      var stored = null;
      try { stored = JSON.parse(window.localStorage.getItem(KEY) || 'null'); }
      catch (e) { stored = null; }
      var prefs = {};
      Object.keys(DEFAULTS).forEach(function (key) {
        prefs[key] = (stored && stored[key] !== undefined) ? stored[key] : DEFAULTS[key];
      });
      /* A stored scale out of range would silently break the slider. */
      if (!(prefs.scale >= 0 && prefs.scale < SCALES.length)) prefs.scale = DEFAULTS.scale;
      if (!DENSITY[prefs.density]) prefs.density = DEFAULTS.density;
      if (!ACCENTS[prefs.accent]) prefs.accent = DEFAULTS.accent;
      return prefs;
    },

    write: function (prefs) {
      try { window.localStorage.setItem(KEY, JSON.stringify(prefs)); }
      catch (e) { /* private mode: the preference just does not persist */ }
    },

    apply: function (prefs) {
      prefs = prefs || VH.prefs.read();
      var rules = [];

      /* Text size. zoom scales the whole layout, which is what "make it
       * bigger" means here - the type scale is in px, so changing the root
       * font size alone would move nothing. */
      var zoom = SCALES[prefs.scale];
      document.documentElement.style.zoom = zoom === 1 ? '' : String(zoom);

      /* Density: rewrite the spacing utilities this design system uses. */
      var factor = DENSITY[prefs.density];
      if (factor !== 1) {
        Object.keys(SPACING_PROPS).forEach(function (prefix) {
          Object.keys(SPACING).forEach(function (token) {
            var value = (SPACING[token] * factor).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
            var selector = '.' + CSS.escape(prefix + '-' + token);
            rules.push(selector + '{' + SPACING_PROPS[prefix].map(function (prop) {
              return prop + ':' + value + 'rem';
            }).join(';') + '}');
          });
        });
      }

      /* Accent. */
      var accent = ACCENTS[prefs.accent];
      if (prefs.accent !== 'emerald') {
        rules.push('.bg-primary{background-color:' + accent.primary + '}');
        rules.push('.bg-primary-container{background-color:' + accent.container + '}');
        rules.push('.bg-primary-fixed-dim{background-color:' + accent.dim + '}');
        rules.push('.text-primary{color:' + accent.primary + '}');
        rules.push('.text-primary-fixed-dim{color:' + accent.dim + '}');
        rules.push('.text-on-primary{color:' + accent.onPrimary + '}');
        rules.push('.border-primary{border-color:' + accent.primary + '}');
        rules.push('.stroke-current.text-primary{stroke:' + accent.primary + '}');
        rules.push('.accent-primary{accent-color:' + accent.primary + '}');
      }

      /* Theme. */
      if (prefs.theme === 'oled') {
        Object.keys(OLED).forEach(function (cls) {
          rules.push('.' + cls + '{background-color:' + OLED[cls] + '}');
        });
        rules.push('body{background-color:#000000}');
      }

      var style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = rules.join('\n');
    },

    /* The design system in db/../frontend/design/DESIGN.md is dark-only: there
     * is no light palette to switch to, and inverting the dark one produces
     * something no one designed. The settings page says this rather than
     * shipping a half-built theme. */
    lightAvailable: false
  };

  VH.prefs.apply();
})(window.VH);
