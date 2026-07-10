// =============================================
//  events.js — City event framework
//
//  Events fire automatically when conditions are met.
//  Add new events by appending to _defs. Nothing else changes.
//  city.activeModifiers — temporary stat modifiers with expiry timestamps
//  city.eventCooldowns  — { [eventId]: lastFiredAt (ms) }
// =============================================

const EventService = (() => {

  function _addModifier(city, stat, value, source, durationSeconds) {
    city.activeModifiers = (city.activeModifiers || []).concat([{
      stat, value, source,
      expiresAt: TimeService.now() + durationSeconds * 1000,
    }]);
  }

  const _defs = [
    {
      id:       'disease_outbreak',
      cooldown: 24 * 3600,
      condition: (city, stats) => stats.hygiene < 20,
      trigger: (city) => {
        const loss = Math.max(5, Math.floor((city.population || 100) * 0.08));
        city.population = Math.max(10, (city.population || 100) - loss);
        _addModifier(city, 'happiness', -12, 'event:disease_outbreak', 6 * 3600);
        return `🦠 Disease swept through ${city.name}! ${loss} people died.`;
      },
    },
    {
      id:       'harvest_festival',
      cooldown: 48 * 3600,
      condition: (city, stats) => stats.happiness >= 75 && (city.buildings.farm || 0) >= 3,
      trigger: (city) => {
        _addModifier(city, 'happiness', 10, 'event:harvest_festival', 3 * 3600);
        return `🎉 Harvest Festival in ${city.name}! Morale soars.`;
      },
    },
    {
      id:       'immigration_wave',
      cooldown: 48 * 3600,
      condition: (city, stats) => stats.happiness >= 80 && (city.population || 100) < 800,
      trigger: (city) => {
        const gain = Math.max(10, Math.floor((city.population || 100) * 0.12));
        city.population = (city.population || 100) + gain;
        return `👥 Prosperity draws settlers to ${city.name}! +${gain} people.`;
      },
    },
    {
      id:       'corruption_scandal',
      cooldown: 72 * 3600,
      condition: (city, stats) => stats.corruption >= 60 && (city.buildings.marketplace || 0) >= 1,
      trigger: (city) => {
        const woodLoss  = Math.floor((city.resources.wood  || 0) * 0.12);
        const stoneLoss = Math.floor((city.resources.stone || 0) * 0.12);
        city.resources.wood  = Math.max(0, (city.resources.wood  || 0) - woodLoss);
        city.resources.stone = Math.max(0, (city.resources.stone || 0) - stoneLoss);
        _addModifier(city, 'happiness', -18, 'event:corruption_scandal', 4 * 3600);
        return `💸 Corruption scandal in ${city.name}! Officials embezzled resources.`;
      },
    },
  ];

  // Check all events and fire at most one that qualifies.
  // Returns array of message strings for triggered events.
  function tick(city) {
    const stats     = CityStatsService.getStats(city);
    const now       = TimeService.now();
    const cooldowns = city.eventCooldowns || {};
    const messages  = [];

    // Expire old modifiers first
    city.activeModifiers = (city.activeModifiers || []).filter(
      m => !m.expiresAt || now < m.expiresAt
    );

    for (const def of _defs) {
      const lastFired = cooldowns[def.id] || 0;
      if (now - lastFired < def.cooldown * 1000) continue;
      if (!def.condition(city, stats)) continue;
      if (messages.length > 0) break;

      messages.push(def.trigger(city, stats));
      cooldowns[def.id] = now;
      city.eventCooldowns = cooldowns;
    }

    if (messages.length > 0) {
      CityService.save(city);
    }

    return messages;
  }

  return { tick };
})();
