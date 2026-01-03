const { MarketSessionGate } = require("../../session/marketSessionGate");

const DEFAULT_SESSION_RULES = {
  sessionDurationMinutes: 390,
  noEntryAfterOpenMinutes: 0,
  noEntryBeforeCloseMinutes: 0,
  noEntryAfterMinutesSinceOpen: 0,
};

function normalizeSessionRules(sessionConfig = {}) {
  const sessionDurationMinutes = Number(sessionConfig.sessionDurationMinutes);
  const noEntryAfterOpenMinutes = Number(sessionConfig.noEntryAfterOpenMinutes);
  const noEntryBeforeCloseMinutes = Number(sessionConfig.noEntryBeforeCloseMinutes);
  const noEntryAfterMinutesSinceOpen = Number(
    sessionConfig.noEntryAfterMinutesSinceOpen
  );

  return {
    sessionDurationMinutes: Number.isFinite(sessionDurationMinutes)
      ? sessionDurationMinutes
      : DEFAULT_SESSION_RULES.sessionDurationMinutes,
    noEntryAfterOpenMinutes: Number.isFinite(noEntryAfterOpenMinutes)
      ? noEntryAfterOpenMinutes
      : DEFAULT_SESSION_RULES.noEntryAfterOpenMinutes,
    noEntryBeforeCloseMinutes: Number.isFinite(noEntryBeforeCloseMinutes)
      ? noEntryBeforeCloseMinutes
      : DEFAULT_SESSION_RULES.noEntryBeforeCloseMinutes,
    noEntryAfterMinutesSinceOpen: Number.isFinite(noEntryAfterMinutesSinceOpen)
      ? noEntryAfterMinutesSinceOpen
      : DEFAULT_SESSION_RULES.noEntryAfterMinutesSinceOpen,
  };
}

function createRuntime({ dataProvider, cacheMs, sessionConfig } = {}) {
  const sessionGate = new MarketSessionGate({ dataProvider, cacheMs });
  const rules = normalizeSessionRules(sessionConfig);

  async function getSession() {
    return await sessionGate.getSession();
  }

  async function isMarketOpen() {
    const session = await sessionGate.getSession();
    return Boolean(session?.isOpen);
  }

  async function getTradeGate() {
    const session = await sessionGate.getSession();
    const isOpen = Boolean(session?.isOpen);
    if (!isOpen) {
      return {
        isOpen: false,
        allowEntries: false,
        reason: "market_closed",
        session,
      };
    }

    const now = Date.now();
    const nextCloseTs = session?.nextClose ? Date.parse(session.nextClose) : NaN;
    const minutesToClose = Number.isFinite(nextCloseTs)
      ? (nextCloseTs - now) / 60000
      : null;
    const minutesSinceOpen =
      minutesToClose != null
        ? rules.sessionDurationMinutes - minutesToClose
        : null;

    if (
      Number.isFinite(rules.noEntryAfterOpenMinutes) &&
      rules.noEntryAfterOpenMinutes > 0 &&
      minutesSinceOpen != null &&
      minutesSinceOpen < rules.noEntryAfterOpenMinutes
    ) {
      return {
        isOpen: true,
        allowEntries: false,
        reason: "no_entry_after_open",
        minutesSinceOpen,
        minutesToClose,
        session,
      };
    }

    if (
      Number.isFinite(rules.noEntryAfterMinutesSinceOpen) &&
      rules.noEntryAfterMinutesSinceOpen > 0 &&
      minutesSinceOpen != null &&
      minutesSinceOpen >= rules.noEntryAfterMinutesSinceOpen
    ) {
      return {
        isOpen: true,
        allowEntries: false,
        reason: "no_entry_after_time",
        minutesSinceOpen,
        minutesToClose,
        session,
      };
    }

    if (
      Number.isFinite(rules.noEntryBeforeCloseMinutes) &&
      rules.noEntryBeforeCloseMinutes > 0 &&
      minutesToClose != null &&
      minutesToClose <= rules.noEntryBeforeCloseMinutes
    ) {
      return {
        isOpen: true,
        allowEntries: false,
        reason: "no_entry_before_close",
        minutesSinceOpen,
        minutesToClose,
        session,
      };
    }

    return {
      isOpen: true,
      allowEntries: true,
      reason: "open",
      minutesSinceOpen,
      minutesToClose,
      session,
    };
  }

  return {
    getSession,
    isMarketOpen,
    getTradeGate,
  };
}

module.exports = { createRuntime };
