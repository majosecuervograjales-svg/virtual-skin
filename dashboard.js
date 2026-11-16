
/*
====================================================
VIRTUAL SKIN 4.0
INTEGRATED ASTRONAUT HEALTH MONITORING SYSTEM
NASA Space Apps Challenge - Research Prototype

SIMULATED PHYSIOLOGICAL DATA
NOT A MEDICAL DEVICE
NOT VALIDATED FOR SPACEFLIGHT

Modules:
01 SKIN-LINK
02 SKIN-MONITOR
03 SKIN-INTELLIGENCE
04 SKIN-BASELINE
05 SKIN-CONTEXT
06 SKIN-SAFETY
07 SKIN-DECISION
08 SKIN-MISSION
09 SKIN-MEMORY
10 SKIN-RESILIENCE
11 MISSION CONTROL
12 SKIN-DEMO
13 SYSTEM CHECK
====================================================
*/

"use strict";

// ==================================================
// CONFIGURATION
// ==================================================

const VS = {
  version: "4.0",
  broker: "wss://broker.emqx.io:8084/mqtt",
  topic: "virtualskin/demo2026/node01/telemetry",
  storageKey: "virtualskin_mission_v1",
  timeout: 5000,
  warningDelay: 5000,
  baselineTarget: 20,
  maxSamples: 3600,
  maxIncidents: 100,
  maxDecisions: 200,
  maxEvents: 100,
  thresholds: {
    hr: { criticalLow: 40, low: 50, high: 100, criticalHigh: 120 },
    spo2: { criticalLow: 90, low: 95 },
    rr: { criticalLow: 8, low: 12, high: 20, criticalHigh: 25 }
  }
};

// ==================================================
// SYSTEM STATE
// ==================================================

const state = {
  hr: 76,
  spo2: 98,
  rr: 16,
  valid: true,
  remoteStatus: null,
  telemetryConnected: false,
  mqttConnected: false,
  lastMessageTime: 0,
  lastStatus: null,
  activity: "rest",
  scenario: "stable",
  history: [],
  baseline: {
    active: false,
    ready: false,
    samples: [],
    reference: null
  }
};

const skinSafety = {
  incidents: [],
  activeIncident: null,
  warningStart: null,
  warningConfirmationMs: VS.warningDelay
};

const skinMission = {
  startedAt: new Date().toISOString(),
  samples: [],
  totalReceived: 0
};

const skinDecision = {
  currentIncidentId: null,
  completedSteps: [],
  records: [],
  notes: {}
};

const skinSystem = {
  events: [],
  connectionLosses: 0,
  invalidMessages: 0,
  lastError: null,
  initialized: false,
  autosaveStarted: false,
  demoMode: false
};

let mqttClient = null;

// ==================================================
// UTILITY FUNCTIONS
// ==================================================

function element(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const target = element(id);
  if (target) target.textContent = String(value);
}

function setWidth(id, value) {
  const target = element(id);
  if (!target) return;
  target.style.width =
    Math.max(0, Math.min(100, value)) + "%";
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function nowISO() {
  return new Date().toISOString();
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleString();
}

function safeUpdate(name, fn) {
  try {
    return fn();
  } catch (error) {
    skinSystem.lastError = name + ": " + error.message;
    console.error("VIRTUAL SKIN", name, error);
    return null;
  }
}

function createPanel(id, title) {
  let panel = element(id);
  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = id;
  panel.className = "vs-module";

  panel.style.cssText = `
    background:#101e32;
    color:#e5eefb;
    border:1px solid #29415f;
    border-radius:14px;
    padding:22px;
    margin:18px 0;
    box-sizing:border-box;
    min-width:0;
  `;

  const heading = document.createElement("h3");
  heading.textContent = title;
  heading.style.cssText =
    "color:#60a5fa;margin:0 0 14px;font-size:17px";

  panel.appendChild(heading);

  const parent =
    document.querySelector(".dashboard") ||
    document.querySelector("main") ||
    document.body;

  parent.appendChild(panel);
  return panel;
}

function panelContent(panel, id) {
  let content = element(id);
  if (!content) {
    content = document.createElement("div");
    content.id = id;
    panel.appendChild(content);
  }
  content.replaceChildren();
  return content;
}

function paragraph(parent, text, color) {
  const p = document.createElement("p");
  p.textContent = text;
  p.style.cssText =
    "margin:9px 0;line-height:1.5;overflow-wrap:anywhere";
  if (color) p.style.color = color;
  parent.appendChild(p);
  return p;
}

function heading(parent, text) {
  const h = document.createElement("h4");
  h.textContent = text;
  h.style.cssText =
    "margin:18px 0 8px;color:#bfdbfe";
  parent.appendChild(h);
  return h;
}

function button(parent, label, fn, disabled = false) {
  const b = document.createElement("button");
  b.textContent = label;
  b.disabled = disabled;
  b.style.cssText = `
    background:${disabled ? "#475569" : "#2563eb"};
    color:white;border:0;border-radius:8px;
    padding:10px 14px;margin:6px 6px 6px 0;
    cursor:${disabled ? "not-allowed" : "pointer"};
    font-weight:600;
  `;
  b.addEventListener("click", fn);
  parent.appendChild(b);
  return b;
}

function addEvent(message) {
  const event = {
    timestamp: nowISO(),
    message: String(message)
  };

  skinSystem.events.unshift(event);
  skinSystem.events =
    skinSystem.events.slice(0, VS.maxEvents);

  const log = element("eventLog");

  if (log) {
    const item = document.createElement("div");
    item.className = "event";
    item.textContent =
      new Date().toLocaleTimeString() +
      " | " + message;

    log.prepend(item);

    while (log.children.length > 15) {
      log.lastElementChild.remove();
    }
  }

  console.log("[VIRTUAL SKIN]", message);
}

function downloadJSON(data, filename) {
  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ==================================================
// SKIN-MONITOR: CLASSIFICATION
// ==================================================

function classify(hr, spo2, rr) {
  const t = VS.thresholds;

  if (
    hr < t.hr.criticalLow ||
    hr > t.hr.criticalHigh ||
    spo2 < t.spo2.criticalLow ||
    rr < t.rr.criticalLow ||
    rr > t.rr.criticalHigh
  ) return "emergency";

  if (
    hr < t.hr.low ||
    hr > t.hr.high ||
    spo2 < t.spo2.low ||
    rr < t.rr.low ||
    rr > t.rr.high
  ) return "warning";

  return "stable";
}

function currentStatus() {
  if (!state.telemetryConnected && !skinSystem.demoMode) {
    return "signal_lost";
  }

  if (!state.valid) return "sensor_error";

  return state.remoteStatus ||
    classify(state.hr, state.spo2, state.rr);
}

function parameterFindings() {
  const t = VS.thresholds;
  const findings = [];

  if (!state.valid) return ["Invalid sensor data"];

  if (state.hr < t.hr.criticalLow)
    findings.push("Critically low heart rate");

  else if (state.hr > t.hr.criticalHigh)
    findings.push("Critically high heart rate");

  else if (state.hr < t.hr.low)
    findings.push("Low heart rate");

  else if (state.hr > t.hr.high)
    findings.push("Elevated heart rate");

  if (state.spo2 < t.spo2.criticalLow)
    findings.push("Critically low simulated oxygen saturation");

  else if (state.spo2 < t.spo2.low)
    findings.push("Reduced simulated oxygen saturation");

  if (state.rr < t.rr.criticalLow)
    findings.push("Critically low respiratory rate");

  else if (state.rr > t.rr.criticalHigh)
    findings.push("Critically high respiratory rate");

  else if (state.rr < t.rr.low)
    findings.push("Low respiratory rate");

  else if (state.rr > t.rr.high)
    findings.push("Elevated respiratory rate");

  return findings;
}

const STATUS_INFO = {
  stable: {
    title: "STABLE",
    icon: "✓",
    description: "Simulated readings within configured ranges.",
    care: "Continue routine monitoring."
  },
  warning: {
    title: "WARNING",
    icon: "⚠",
    description: "One or more readings require review.",
    care: "Verify measurements, trends and activity context."
  },
  emergency: {
    title: "EMERGENCY",
    icon: "!",
    description: "Critical simulated threshold or emergency input.",
    care: "Notify the crew and follow approved emergency procedures."
  },
  sensor_error: {
    title: "SENSOR ERROR",
    icon: "!",
    description: "Invalid sensor acquisition.",
    care: "Verify acquisition before interpreting the values."
  },
  signal_lost: {
    title: "SIGNAL LOST",
    icon: "!",
    description: "Live physiological information is unavailable.",
    care: "Restore communication. Last values must not be treated as current."
  }
};

function registerHistory() {
  state.history.push(state.hr);
  state.history = state.history.slice(-60);
}

function calculateTrend() {
  const values = state.history;

  if (values.length < 10) {
    return { label: "Collecting data", difference: 0 };
  }

  const last = values.slice(-10);
  const difference =
    mean(last.slice(5)) - mean(last.slice(0, 5));

  return {
    label:
      difference >= 10 ? "Increasing" :
      difference <= -10 ? "Decreasing" :
      "No major net change",
    difference
  };
}

function drawChart() {
  const canvas = element("heartChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.clientWidth || 500;
  const height = canvas.clientHeight || 180;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = "#29415f";
  ctx.lineWidth = 1;

  for (let i = 1; i < 5; i++) {
    const y = height * i / 5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  if (state.history.length < 2) return;

  ctx.strokeStyle = "#60a5fa";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.beginPath();

  state.history.forEach((value, index) => {
    const x =
      index * width / (state.history.length - 1);

    const y = Math.max(
      0,
      Math.min(height, height - (value / 200) * height)
    );

    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();
}

function updateDashboard() {
  const status = currentStatus();
  const info = STATUS_INFO[status];

  const live =
    state.telemetryConnected || skinSystem.demoMode;

  setText("heartRate", live && state.valid
    ? state.hr.toFixed(1) : "--");

  setText("spo2", live && state.valid
    ? state.spo2.toFixed(1) : "--");

  setText("respiration", live && state.valid
    ? state.rr.toFixed(1) : "--");

  setWidth("heartBar", live ? state.hr / 200 * 100 : 0);
  setWidth("oxygenBar", live ? state.spo2 : 0);
  setWidth("respBar", live ? state.rr / 40 * 100 : 0);

  const panel = element("statusPanel");
  if (panel) panel.className = "status " + status;

  setText("statusTitle", info.title);
  setText("statusDescription", info.description);
  setText("statusIcon", info.icon);
  setText("careTitle", "CREW GUIDANCE");
  setText("careText", info.care);

  if (status !== state.lastStatus) {
    addEvent("Status: " + status.toUpperCase());
    state.lastStatus = status;
  }

  setText(
    "averageHR",
    state.history.length
      ? "Average: " + mean(state.history).toFixed(1) + " BPM"
      : "Average: Collecting data"
  );

  setText("trendHR", "Trend: " + calculateTrend().label);

  drawChart();
}

// ==================================================
// SKIN-BASELINE
// ==================================================

function startBaselineCalibration() {
  if (
    !state.telemetryConnected ||
    !state.valid ||
    currentStatus() !== "stable"
  ) {
    addEvent("Baseline requires stable live telemetry");
    return;
  }

  state.baseline = {
    active: true,
    ready: false,
    samples: [],
    reference: null
  };

  addEvent("Personal baseline calibration started");
  renderBaselinePanel();
}

function collectBaselineSample(data) {
  const b = state.baseline;

  if (
    !b.active ||
    !data.valid ||
    data.status !== "stable"
  ) return;

  b.samples.push({
    hr: data.hr,
    spo2: data.spo2,
    rr: data.rr
  });

  if (b.samples.length < VS.baselineTarget) return;

  b.reference = {
    hr: mean(b.samples.map(x => x.hr)),
    spo2: mean(b.samples.map(x => x.spo2)),
    rr: mean(b.samples.map(x => x.rr))
  };

  b.active = false;
  b.ready = true;

  addEvent("Personal baseline established");
  saveSkinMemory();
}

function evaluateBaseline() {
  if (!state.baseline.ready || !state.valid) return null;

  const ref = state.baseline.reference;

  const deviation = {
    hr: state.hr - ref.hr,
    spo2: state.spo2 - ref.spo2,
    rr: state.rr - ref.rr
  };

  const findings = [];

  if (Math.abs(deviation.hr) >= 15)
    findings.push("HR differs from baseline");

  if (Math.abs(deviation.spo2) >= 3)
    findings.push("SpO2 differs from baseline");

  if (Math.abs(deviation.rr) >= 5)
    findings.push("RR differs from baseline");

  return { deviation, findings };
}

function renderBaselinePanel() {
  const panel = createPanel(
    "baselinePanel",
    "SKIN-BASELINE | PERSONAL REFERENCE"
  );

  const content = panelContent(panel, "baselineContent");
  const b = state.baseline;

  paragraph(
    content,
    b.active
      ? `Calibrating: ${b.samples.length}/${VS.baselineTarget}`
      : b.ready
        ? "Personal reference established"
        : "Calibration not started"
  );

  button(
    content,
    b.active ? "CALIBRATING..." :
      b.ready ? "RECALIBRATE" : "START CALIBRATION",
    startBaselineCalibration,
    b.active
  );

  if (!b.ready) return;

  const r = b.reference;

  paragraph(
    content,
    `Reference: HR ${r.hr.toFixed(1)} BPM | ` +
    `SpO2 ${r.spo2.toFixed(1)}% | ` +
    `RR ${r.rr.toFixed(1)} RPM`
  );

  if (!state.telemetryConnected) {
    paragraph(
      content,
      "Current comparison paused: live telemetry unavailable.",
      "#facc15"
    );
    return;
  }

  const result = evaluateBaseline();
  if (!result) return;

  paragraph(
    content,
    `Deviation: HR ${result.deviation.hr.toFixed(1)} | ` +
    `SpO2 ${result.deviation.spo2.toFixed(1)} | ` +
    `RR ${result.deviation.rr.toFixed(1)}`
  );

  paragraph(
    content,
    result.findings.length
      ? result.findings.join(" | ")
      : "No major personal deviation",
    result.findings.length ? "#facc15" : "#4ade80"
  );
}

// ==================================================
// SKIN-CONTEXT
// ==================================================

function renderContextPanel() {
  const panel = createPanel(
    "contextPanel",
    "SKIN-CONTEXT | ACTIVITY INTERPRETATION"
  );

  let selector = element("activityContext");

  if (!selector) {
    const label = document.createElement("label");
    label.textContent = "Astronaut activity: ";
    label.htmlFor = "activityContext";
    panel.appendChild(label);

    selector = document.createElement("select");
    selector.id = "activityContext";

    selector.style.cssText =
      "padding:9px;background:#172b47;color:white;" +
      "border:1px solid #60a5fa;border-radius:8px;margin:8px";

    [
      ["rest", "Rest"],
      ["exercise", "Exercise"],
      ["recovery", "Recovery"]
    ].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      selector.appendChild(option);
    });

    selector.addEventListener("change", () => {
      state.activity = selector.value;
      addEvent("Activity: " + state.activity);
      saveSkinMemory();
      refreshPanels();
    });

    panel.appendChild(selector);
  }

  selector.value = state.activity;

  const content = panelContent(panel, "contextContent");

  const messages = {
    rest: "Rest context: deviations may require closer review.",
    exercise:
      "Exercise context: HR and RR may rise with exertion. " +
      "Safety thresholds remain active.",
    recovery:
      "Recovery context: compare subsequent readings " +
      "with the personal baseline."
  };

  paragraph(content, messages[state.activity]);

  if (!state.telemetryConnected) {
    paragraph(content, "Live analysis unavailable.", "#facc15");
  } else if (!state.valid) {
    paragraph(content, "Invalid sensor data.", "#facc15");
  } else {
    const findings = parameterFindings();

    paragraph(
      content,
      findings.length
        ? findings.join(" | ")
        : "No configured threshold deviations"
    );
  }

  paragraph(
    content,
    "Activity is selected manually. This is not automatic " +
    "activity recognition or clinical interpretation.",
    "#94a3b8"
  );
}

// ==================================================
// SKIN-INTELLIGENCE
// ==================================================

function analyzePhysiology() {
  if (!state.telemetryConnected || !state.valid) {
    return {
      findings: ["Current analysis unavailable"],
      recommendations: ["Verify sensor and communication"],
      trend: "Unavailable"
    };
  }

  const findings = parameterFindings();
  const recommendations = [];

  if (findings.length) {
    recommendations.push("Verify sensor quality");
    recommendations.push("Review recent activity");
    recommendations.push("Confirm subsequent readings");
  }

  if (state.spo2 < 95) {
    recommendations.push("Review simulated SpO2 acquisition");
  }

  if (state.hr > 100 && state.rr > 20) {
    findings.push("Combined HR and RR elevation");
  }

  const baseline = evaluateBaseline();

  if (baseline) {
    findings.push(...baseline.findings);
  }

  const trend = calculateTrend();

  if (trend.label !== "No major net change" &&
      trend.label !== "Collecting data") {
    findings.push("HR trend: " + trend.label);
  }

  return {
    findings: [...new Set(findings)],
    recommendations: [...new Set(recommendations)],
    trend: trend.label
  };
}

function renderIntelligencePanel() {
  const panel = createPanel(
    "intelligencePanel",
    "SKIN-INTELLIGENCE | EXPLAINABLE ANALYSIS"
  );

  const content = panelContent(
    panel,
    "intelligenceContent"
  );

  const analysis = analyzePhysiology();

  paragraph(content, "HR trend: " + analysis.trend);

  paragraph(
    content,
    "Findings: " +
    (analysis.findings.length
      ? analysis.findings.join(" | ")
      : "No deviations detected"),
    analysis.findings.length ? "#facc15" : "#4ade80"
  );

  paragraph(
    content,
    "Suggested checks: " +
    (analysis.recommendations.length
      ? analysis.recommendations.join(" | ")
      : "Continue monitoring")
  );

  paragraph(
    content,
    "Analysis uses transparent rules, not a trained AI model.",
    "#94a3b8"
  );
}

// ==================================================
// SKIN-SAFETY
// ==================================================

function incidentReason(status) {
  if (status === "sensor_error")
    return "Invalid sensor acquisition";

  const findings = parameterFindings();

  return findings.length
    ? findings.join("; ")
    : status === "emergency"
      ? "ESP32 emergency signal or critical condition"
      : "Persistent warning condition";
}

function createSafetyIncident(status) {
  const incident = {
    id: "INC-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 6),
    status,
    reason: incidentReason(status),
    startedAt: nowISO(),
    endedAt: null,
    active: true,
    acknowledged: false,
    acknowledgedAt: null,
    closureReason: null,
    activity: state.activity,
    measurements: {
      hr: state.hr,
      spo2: state.spo2,
      rr: state.rr
    }
  };

  skinSafety.incidents.unshift(incident);
  skinSafety.incidents =
    skinSafety.incidents.slice(0, VS.maxIncidents);

  skinSafety.activeIncident = incident;
  skinDecision.currentIncidentId = incident.id;
  skinDecision.completedSteps = [];

  addEvent("Incident opened: " + status.toUpperCase());
  saveSkinMemory();
}

function closeSafetyIncident(reason = "Condition changed") {
  const incident = skinSafety.activeIncident;
  if (!incident) return;

  incident.active = false;
  incident.endedAt = nowISO();
  incident.closureReason = reason;

  skinSafety.activeIncident = null;
  skinDecision.currentIncidentId = null;
  skinDecision.completedSteps = [];

  addEvent("Incident closed: " + reason);
  saveSkinMemory();
}

function acknowledgeSafetyIncident() {
  const incident = skinSafety.activeIncident;
  if (!incident) return;

  incident.acknowledged = true;
  incident.acknowledgedAt = nowISO();

  addEvent("Incident acknowledged: " + incident.id);
  saveSkinMemory();
  refreshPanels();
}

function processSafetyStatus() {
  if (!state.telemetryConnected) return;

  const status = currentStatus();
  const active = skinSafety.activeIncident;

  if (status === "warning") {
    if (skinSafety.warningStart === null) {
      skinSafety.warningStart = Date.now();
    }

    if (
      Date.now() - skinSafety.warningStart <
      skinSafety.warningConfirmationMs
    ) {
      return;
    }
  } else {
    skinSafety.warningStart = null;
  }

  if (status === "stable") {
    if (active) closeSafetyIncident("Readings returned to stable");
    return;
  }

  if (active && active.status === status) return;

  if (active) {
    closeSafetyIncident("Replaced by " + status);
  }

  createSafetyIncident(status);
}

function renderSafetyPanel() {
  const panel = createPanel(
    "safetyPanel",
    "SKIN-SAFETY | INCIDENT MANAGEMENT"
  );

  const content = panelContent(panel, "safetyContent");
  const active = skinSafety.activeIncident;

  if (!active) {
    paragraph(
      content,
      state.telemetryConnected
        ? "No active physiological incident."
        : "Physiological status unknown: telemetry unavailable.",
      state.telemetryConnected ? "#4ade80" : "#facc15"
    );
  } else {
    paragraph(
      content,
      "ACTIVE: " + active.status.toUpperCase(),
      active.status === "emergency"
        ? "#f87171" : "#facc15"
    );

    paragraph(content, "Reason: " + active.reason);
    paragraph(content, "Started: " + formatTime(active.startedAt));

    paragraph(
      content,
      "Acknowledgment: " +
      (active.acknowledged ? "CONFIRMED" : "PENDING")
    );

    if (!active.acknowledged) {
      button(
        content,
        "ACKNOWLEDGE ALERT",
        acknowledgeSafetyIncident
      );
    }
  }

  heading(content, "RECENT INCIDENTS");

  if (!skinSafety.incidents.length) {
    paragraph(content, "No incidents recorded.");
  }

  skinSafety.incidents.slice(0, 8).forEach(item => {
    paragraph(
      content,
      `${formatTime(item.startedAt)} | ` +
      `${item.status.toUpperCase()} | ` +
      `${item.active ? "ACTIVE" : "CLOSED"} | ` +
      `${item.acknowledged ? "ACKNOWLEDGED" : "PENDING"}`
    );
  });
}

// ==================================================
// SKIN-DECISION 2.0
// ==================================================

const DECISION_STEPS = [
  {
    id: "sensor",
    title: "VERIFY SENSOR",
    description: "Check acquisition integrity and sensor placement."
  },
  {
    id: "context",
    title: "REVIEW CONTEXT",
    description: "Review activity, recent exertion and trends."
  },
  {
    id: "repeat",
    title: "CONFIRM READING",
    description: "Review subsequent readings for persistence."
  },
  {
    id: "crew",
    title: "FOLLOW CREW PROCEDURE",
    description:
      "Notify the appropriate crew member and follow approved procedures."
  }
];

function synchronizeDecisionIncident() {
  const incident = skinSafety.activeIncident;
  const id = incident ? incident.id : null;

  if (skinDecision.currentIncidentId !== id) {
    skinDecision.currentIncidentId = id;
    skinDecision.completedSteps = [];
  }
}

function toggleDecisionStep(id, checked) {
  if (!skinSafety.activeIncident) return;

  if (checked) {
    if (!skinDecision.completedSteps.includes(id)) {
      skinDecision.completedSteps.push(id);
    }
  } else {
    skinDecision.completedSteps =
      skinDecision.completedSteps.filter(x => x !== id);
  }

  renderDecisionPanel();
}

function saveDecisionRecord() {
  const incident = skinSafety.activeIncident;

  if (!incident) {
    addEvent("No active incident to document");
    return;
  }

  const notes = element("decisionNotes");

  const record = {
    timestamp: nowISO(),
    incidentId: incident.id,
    incidentStatus: incident.status,
    completedSteps: [...skinDecision.completedSteps],
    totalSteps: DECISION_STEPS.length,
    notes: notes ? notes.value.trim().slice(0, 1000) : "",
    activity: state.activity,
    measurements: {
      hr: state.hr,
      spo2: state.spo2,
      rr: state.rr
    },
    limitation:
      "Checklist documentation, not medical diagnosis."
  };

  skinDecision.records.unshift(record);
  skinDecision.records =
    skinDecision.records.slice(0, VS.maxDecisions);

  addEvent("Crew response documented: " + incident.id);
  saveSkinMemory();
  refreshPanels();
}

function renderDecisionPanel() {
  synchronizeDecisionIncident();

  const panel = createPanel(
    "decisionPanel",
    "SKIN-DECISION | CREW RESPONSE ASSISTANT"
  );

  const content = panelContent(panel, "decisionContent");
  const incident = skinSafety.activeIncident;

  if (!state.telemetryConnected) {
    paragraph(
      content,
      "SIGNAL UNAVAILABLE. Do not interpret old readings as current.",
      "#facc15"
    );
    return;
  }

  if (!incident) {
    paragraph(
      content,
      "No active incident requiring a response checklist.",
      "#4ade80"
    );

    paragraph(
      content,
      "Documented responses: " + skinDecision.records.length
    );
    return;
  }

  paragraph(
    content,
    "ACTIVE ALERT: " + incident.status.toUpperCase(),
    incident.status === "emergency"
      ? "#f87171" : "#facc15"
  );

  paragraph(content, "Incident ID: " + incident.id);

  paragraph(
    content,
    `HR ${state.hr.toFixed(1)} BPM | ` +
    `SpO2 ${state.spo2.toFixed(1)}% | ` +
    `RR ${state.rr.toFixed(1)} RPM`
  );

  if (incident.status === "emergency") {
    paragraph(
      content,
      "PRIORITY: Notify the crew and follow approved " +
      "emergency procedures. Do not delay escalation " +
      "to complete the checklist.",
      "#f87171"
    );
  }

  if (incident.status === "sensor_error") {
    paragraph(
      content,
      "Sensor data are invalid. Verify acquisition.",
      "#facc15"
    );
  }

  heading(content, "CREW RESPONSE CHECKLIST");

  DECISION_STEPS.forEach(step => {
    const wrapper = document.createElement("div");

    wrapper.style.cssText =
      "background:#172b47;border-radius:9px;" +
      "padding:12px;margin:9px 0";

    const label = document.createElement("label");
    label.style.cssText =
      "display:flex;gap:10px;align-items:flex-start;cursor:pointer";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked =
      skinDecision.completedSteps.includes(step.id);

    checkbox.addEventListener("change", () => {
      toggleDecisionStep(step.id, checkbox.checked);
    });

    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = step.title;

    const description = document.createElement("div");
    description.textContent = step.description;
    description.style.cssText =
      "font-size:13px;opacity:.8;margin-top:4px";

    text.append(strong, description);
    label.append(checkbox, text);
    wrapper.appendChild(label);
    content.appendChild(wrapper);
  });

  paragraph(
    content,
    `Completed: ${skinDecision.completedSteps.length}/` +
    DECISION_STEPS.length
  );

  heading(content, "CREW NOTES");

  const notes = document.createElement("textarea");
  notes.id = "decisionNotes";
  notes.placeholder =
    "Document observations or communication with the crew...";
  notes.rows = 3;
  notes.maxLength = 1000;
  notes.value = skinDecision.notes[incident.id] || "";

  notes.style.cssText =
    "width:100%;box-sizing:border-box;padding:10px;" +
    "border-radius:8px;background:#172b47;color:white;" +
    "border:1px solid #29415f";

  notes.addEventListener("input", () => {
    skinDecision.notes[incident.id] = notes.value;
  });

  content.appendChild(notes);

  button(
    content,
    "DOCUMENT CREW RESPONSE",
    saveDecisionRecord
  );

  paragraph(
    content,
    "Responses recorded: " + skinDecision.records.length
  );
}

// ==================================================
// SKIN-MISSION: REPORTING
// ==================================================

function recordMissionSample(data) {
  if (!data.valid) return;

  skinMission.totalReceived++;

  skinMission.samples.push({
    timestamp: nowISO(),
    hr: data.hr,
    spo2: data.spo2,
    rr: data.rr,
    status: data.status,
    activity: state.activity
  });

  skinMission.samples =
    skinMission.samples.slice(-VS.maxSamples);
}

function metricStatistics(samples, key) {
  const values = samples.map(x => x[key]);

  if (!values.length) return null;

  return {
    mean: mean(values),
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

function missionStatistics() {
  const samples = skinMission.samples;
  if (!samples.length) return null;

  return {
    retainedSamples: samples.length,
    totalReceived: skinMission.totalReceived,
    hr: metricStatistics(samples, "hr"),
    spo2: metricStatistics(samples, "spo2"),
    rr: metricStatistics(samples, "rr"),
    warningSamples: samples.filter(
      x => x.status === "warning"
    ).length,
    emergencySamples: samples.filter(
      x => x.status === "emergency"
    ).length
  };
}

function buildMissionReport() {
  return {
    project: "VIRTUAL SKIN",
    version: VS.version,
    description:
      "Simulated astronaut physiological monitoring and " +
      "decision-support research prototype",
    startedAt: skinMission.startedAt,
    exportedAt: nowISO(),

    architecture: {
      simulatedDevice: "ESP32 in Wokwi",
      transport: "MQTT over WebSockets",
      dashboard: "CodePen JavaScript",
      storage: "Browser localStorage"
    },

    thresholds: VS.thresholds,
    statistics: missionStatistics(),

    baseline: state.baseline.ready
      ? state.baseline.reference
      : null,

    incidents: skinSafety.incidents,
    crewDecisionRecords: skinDecision.records,
    events: skinSystem.events,
    samples: skinMission.samples,

    systemHealth: {
      connectionLosses: skinSystem.connectionLosses,
      invalidMessages: skinSystem.invalidMessages
    },

    limitations: [
      "Physiological measurements are simulated.",
      "Thresholds are experimental, not clinically validated.",
      "The system does not diagnose or prescribe treatment.",
      "The MQTT broker is public and must not carry real health data.",
      "Browser storage is local and may be cleared.",
      "This implementation has not been validated for spaceflight.",
      "No trained artificial intelligence model is used."
    ]
  };
}

function exportMissionReport() {
  const filename =
    "VIRTUAL_SKIN_REPORT_" +
    nowISO().replace(/[:.]/g, "-") +
    ".json";

  downloadJSON(buildMissionReport(), filename);
  addEvent("Mission report exported");
}

function renderMissionPanel() {
  const panel = createPanel(
    "missionPanel",
    "SKIN-MISSION | MISSION HEALTH REPORT"
  );

  const content = panelContent(panel, "missionContent");
  const stats = missionStatistics();

  paragraph(
    content,
    "Mission started: " + formatTime(skinMission.startedAt)
  );

  if (!stats) {
    paragraph(content, "Waiting for valid telemetry.");
  } else {
    paragraph(
      content,
      `Samples: ${stats.retainedSamples} retained / ` +
      `${stats.totalReceived} received`
    );

    [
      ["HR", stats.hr, "BPM"],
      ["SpO2", stats.spo2, "%"],
      ["RR", stats.rr, "RPM"]
    ].forEach(([name, s, unit]) => {
      paragraph(
        content,
        `${name}: mean ${s.mean.toFixed(1)} ${unit} | ` +
        `min ${s.min.toFixed(1)} | max ${s.max.toFixed(1)}`
      );
    });

    paragraph(
      content,
      `Warning samples: ${stats.warningSamples} | ` +
      `Emergency samples: ${stats.emergencySamples}`
    );
  }

  paragraph(
    content,
    "Incidents: " + skinSafety.incidents.length
  );

  paragraph(
    content,
    "Documented crew responses: " +
    skinDecision.records.length
  );

  button(
    content,
    "EXPORT MISSION REPORT",
    exportMissionReport
  );
}

// ==================================================
// SKIN-MEMORY
// ==================================================

function saveSkinMemory() {
  try {
    const memory = {
      version: 2,
      savedAt: nowISO(),

      mission: {
        startedAt: skinMission.startedAt,
        samples: skinMission.samples,
        totalReceived: skinMission.totalReceived
      },

      baseline: {
        ready: state.baseline.ready,
        reference: state.baseline.reference
      },

      safety: {
        incidents: skinSafety.incidents
      },

      decision: {
        records: skinDecision.records
      },

      activity: state.activity,

      system: {
        events: skinSystem.events,
        connectionLosses: skinSystem.connectionLosses,
        invalidMessages: skinSystem.invalidMessages
      }
    };

    localStorage.setItem(
      VS.storageKey,
      JSON.stringify(memory)
    );

    return true;
  } catch (error) {
    console.error("SKIN-MEMORY save:", error);
    return false;
  }
}

function loadSkinMemory() {
  try {
    const raw = localStorage.getItem(VS.storageKey);
    if (!raw) return false;

    const memory = JSON.parse(raw);

    if (!memory || ![1, 2].includes(memory.version)) {
      return false;
    }

    if (memory.mission) {
      const mission = memory.mission;

      if (
        typeof mission.startedAt === "string" &&
        Number.isFinite(Date.parse(mission.startedAt))
      ) {
        skinMission.startedAt = mission.startedAt;
      }

      if (Array.isArray(mission.samples)) {
        skinMission.samples = mission.samples
          .filter(x =>
            x &&
            Number.isFinite(x.hr) &&
            Number.isFinite(x.spo2) &&
            Number.isFinite(x.rr)
          )
          .slice(-VS.maxSamples);
      }

      skinMission.totalReceived =
        Number.isSafeInteger(mission.totalReceived)
          ? Math.max(
              mission.totalReceived,
              skinMission.samples.length
            )
          : skinMission.samples.length;
    }

    if (memory.baseline) {
      const ref = memory.baseline.reference;

      const validRef =
        ref &&
        Number.isFinite(ref.hr) &&
        Number.isFinite(ref.spo2) &&
        Number.isFinite(ref.rr);

      state.baseline.ready =
        memory.baseline.ready === true && !!validRef;

      state.baseline.reference =
        state.baseline.ready ? ref : null;
    }

    if (
      memory.safety &&
      Array.isArray(memory.safety.incidents)
    ) {
      skinSafety.incidents =
        memory.safety.incidents
          .filter(x =>
            x &&
            typeof x.id === "string" &&
            typeof x.status === "string"
          )
          .slice(0, VS.maxIncidents)
          .map(x => ({
            ...x,
            active: false,
            endedAt: x.endedAt ||
              memory.savedAt || nowISO(),
            closureReason: x.closureReason ||
              "Previous browser session ended"
          }));
    }

    if (
      memory.decision &&
      Array.isArray(memory.decision.records)
    ) {
      skinDecision.records =
        memory.decision.records
          .filter(x =>
            x &&
            typeof x.incidentId === "string" &&
            Array.isArray(x.completedSteps)
          )
          .slice(0, VS.maxDecisions);
    }

    if (
      ["rest", "exercise", "recovery"]
        .includes(memory.activity)
    ) {
      state.activity = memory.activity;
    }

    if (memory.system) {
      if (Array.isArray(memory.system.events)) {
        skinSystem.events =
          memory.system.events.slice(0, VS.maxEvents);
      }

      skinSystem.connectionLosses =
        Number.isSafeInteger(
          memory.system.connectionLosses
        ) ? memory.system.connectionLosses : 0;

      skinSystem.invalidMessages =
        Number.isSafeInteger(
          memory.system.invalidMessages
        ) ? memory.system.invalidMessages : 0;
    }

    addEvent("Previous mission session restored");
    return true;
  } catch (error) {
    console.error("SKIN-MEMORY restore:", error);
    return false;
  }
}

function startSkinAutosave() {
  if (skinSystem.autosaveStarted) return;

  skinSystem.autosaveStarted = true;

  setInterval(saveSkinMemory, 10000);

  window.addEventListener(
    "pagehide",
    saveSkinMemory
  );
}

// ==================================================
// SKIN-RESILIENCE
// ==================================================

function setConnectionIndicator(text, color) {
  let indicator = element("skinConnection");

  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "skinConnection";

    indicator.style.cssText = `
      position:fixed;top:12px;right:12px;
      z-index:9999;padding:10px 14px;
      border-radius:9px;background:#102238;
      border:1px solid #29415f;
      font-size:12px;font-weight:700;
      max-width:75vw;
    `;

    document.body.appendChild(indicator);
  }

  indicator.textContent = text;
  indicator.style.color = color;
}

function handleSignalLoss(reason) {
  const wasLive = state.telemetryConnected;

  state.telemetryConnected = false;
  skinSafety.warningStart = null;

  if (wasLive) {
    skinSystem.connectionLosses++;
    addEvent("Telemetry interrupted: " + reason);
  }

  // The last physiological condition is now unknown.
  // Preserve incident history, but close the live episode.
  if (skinSafety.activeIncident) {
    closeSafetyIncident("Telemetry interrupted");
  }

  setConnectionIndicator(
    reason,
    "#f87171"
  );

  refreshPanels();
}

function checkTelemetrySafety() {
  if (!state.lastMessageTime) return;
  if (!state.telemetryConnected) return;

  if (
    Date.now() - state.lastMessageTime >
    VS.timeout
  ) {
    handleSignalLoss("TELEMETRY SIGNAL LOST");
  }
}

// ==================================================
// MQTT VALIDATION
// ==================================================

function validateTelemetry(data) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) return false;

  if (
    !["stable", "warning", "emergency", "sensor_error"]
      .includes(data.status)
  ) return false;

  if (typeof data.valid !== "boolean") return false;

  if (!data.valid) {
    return data.status === "sensor_error";
  }

  return (
    Number.isFinite(data.hr) &&
    Number.isFinite(data.spo2) &&
    Number.isFinite(data.rr) &&
    data.hr >= 0 &&
    data.hr <= 250 &&
    data.spo2 >= 0 &&
    data.spo2 <= 100 &&
    data.rr >= 0 &&
    data.rr <= 80 &&
    data.status !== "sensor_error"
  );
}

function processTelemetry(data) {
  if (!validateTelemetry(data)) {
    skinSystem.invalidMessages++;
    console.warn("Rejected telemetry:", data);
    return;
  }

  skinSystem.demoMode = false;

  state.lastMessageTime = Date.now();
  state.telemetryConnected = true;
  state.valid = data.valid;
  state.remoteStatus = data.status;

  if (data.valid) {
    state.hr = data.hr;
    state.spo2 = data.spo2;
    state.rr = data.rr;

    registerHistory();
    collectBaselineSample(data);
    recordMissionSample(data);
  }

  setConnectionIndicator(
    data.valid
      ? "LIVE - ESP32 CONNECTED"
      : "LIVE - SENSOR DATA INVALID",
    data.valid ? "#4ade80" : "#facc15"
  );

  processSafetyStatus();
  refreshPanels();
}

function connectMQTT() {
  if (typeof mqtt === "undefined") {
    setConnectionIndicator(
      "MQTT LIBRARY NOT LOADED",
      "#f87171"
    );

    addEvent("MQTT.js library missing");
    return;
  }

  if (mqttClient) return;

  setConnectionIndicator(
    "CONNECTING TO MQTT...",
    "#facc15"
  );

  mqttClient = mqtt.connect(VS.broker, {
    clientId:
      "virtualskin_web_" +
      Math.random().toString(16).slice(2),
    clean: true,
    reconnectPeriod: 2000,
    connectTimeout: 10000
  });

  mqttClient.on("connect", () => {
    state.mqttConnected = true;

    setConnectionIndicator(
      "MQTT CONNECTED - WAITING FOR DATA",
      "#facc15"
    );

    mqttClient.subscribe(
      VS.topic,
      { qos: 0 },
      error => {
        if (error) {
          console.error(error);
          addEvent("MQTT subscription error");
        } else {
          addEvent("Telemetry topic subscribed");
        }
      }
    );
  });

  mqttClient.on("message", (topic, payload) => {
    if (topic !== VS.topic) return;

    try {
      const data = JSON.parse(payload.toString());
      safeUpdate(
        "Telemetry processing",
        () => processTelemetry(data)
      );
    } catch (error) {
      skinSystem.invalidMessages++;
      console.error("MQTT payload error:", error);
    }
  });

  mqttClient.on("reconnect", () => {
    state.mqttConnected = false;
    handleSignalLoss("MQTT RECONNECTING");
  });

  mqttClient.on("offline", () => {
    state.mqttConnected = false;
    handleSignalLoss("MQTT OFFLINE");
  });

  mqttClient.on("close", () => {
    state.mqttConnected = false;
    handleSignalLoss("MQTT DISCONNECTED");
  });

  mqttClient.on("error", error => {
    skinSystem.lastError = error.message;
    console.error("MQTT error:", error);
  });
}

// ==================================================
// MISSION CONTROL
// ==================================================

function renderMissionControl() {
  const panel = createPanel(
    "missionControlPanel",
    "SKIN-MISSION CONTROL | COMMAND OVERVIEW"
  );

  const content = panelContent(
    panel,
    "missionControlContent"
  );

  const live = state.telemetryConnected;

  paragraph(
    content,
    "SIGNAL: " +
    (live ? "LIVE TELEMETRY" : "UNAVAILABLE"),
    live ? "#4ade80" : "#f87171"
  );

  paragraph(
    content,
    "HEALTH STATUS: " + currentStatus().toUpperCase()
  );

  paragraph(
    content,
    "ACTIVITY: " + state.activity.toUpperCase()
  );

  paragraph(
    content,
    "ACTIVE INCIDENT: " +
    (skinSafety.activeIncident
      ? skinSafety.activeIncident.status.toUpperCase()
      : "NONE")
  );

  paragraph(
    content,
    "TOTAL INCIDENTS: " + skinSafety.incidents.length
  );

  paragraph(
    content,
    "CREW RESPONSES: " + skinDecision.records.length
  );

  paragraph(
    content,
    "MISSION SAMPLES: " + skinMission.totalReceived
  );

  paragraph(
    content,
    "PERSONAL BASELINE: " +
    (state.baseline.ready
      ? "CALIBRATED"
      : state.baseline.active
        ? "CALIBRATING"
        : "NOT CALIBRATED")
  );

  paragraph(
    content,
    "CONNECTION INTERRUPTIONS: " +
    skinSystem.connectionLosses
  );

  heading(content, "RECENT EVENTS");

  skinSystem.events.slice(0, 5).forEach(event => {
    paragraph(
      content,
      formatTime(event.timestamp) +
      " | " + event.message
    );
  });
}

// ==================================================
// SKIN-DEMO
// ==================================================

const DEMO_SCENARIOS = {
  stable: {
    hr: 76, spo2: 98, rr: 16
  },
  warning: {
    hr: 110, spo2: 96, rr: 19
  },
  emergency: {
    hr: 135, spo2: 86, rr: 29
  },
  recovery: {
    hr: 85, spo2: 97, rr: 17
  }
};

function setScenario(name) {
  const scenario = DEMO_SCENARIOS[name];
  if (!scenario) return;

  if (state.telemetryConnected) {
    addEvent(
      "Demo preview unavailable while ESP32 is live"
    );
    return;
  }

  skinSystem.demoMode = true;
  state.scenario = name;
  state.hr = scenario.hr;
  state.spo2 = scenario.spo2;
  state.rr = scenario.rr;
  state.valid = true;
  state.remoteStatus = null;

  // Preview only. Does not record physiological
  // incidents or mission samples.

  setConnectionIndicator(
    "DEMO PREVIEW - NOT LIVE",
    "#facc15"
  );

  refreshPanels();
}

function exitDemoMode() {
  skinSystem.demoMode = false;
  refreshPanels();
}

function renderDemoPanel() {
  const panel = createPanel(
    "demoPanel",
    "SKIN-DEMO | SCENARIO PREVIEW"
  );

  const content = panelContent(panel, "demoContent");

  paragraph(
    content,
    "Preview simulated states without changing the ESP32. " +
    "For a recorded mission demonstration, use Wokwi."
  );

  Object.keys(DEMO_SCENARIOS).forEach(name => {
    button(
      content,
      name.toUpperCase(),
      () => setScenario(name),
      state.telemetryConnected
    );
  });

  button(
    content,
    "EXIT PREVIEW",
    exitDemoMode
  );

  paragraph(
    content,
    skinSystem.demoMode
      ? "PREVIEW ACTIVE: values are not live telemetry."
      : "Preview inactive.",
    skinSystem.demoMode ? "#facc15" : "#94a3b8"
  );
}

// ==================================================
// SYSTEM CHECK
// ==================================================

function systemCheckResults() {
  return [
    {
      name: "MQTT library",
      ok: typeof mqtt !== "undefined"
    },
    {
      name: "MQTT broker connection",
      ok: state.mqttConnected
    },
    {
      name: "Live telemetry",
      ok: state.telemetryConnected
    },
    {
      name: "Valid sensor data",
      ok: state.telemetryConnected && state.valid
    },
    {
      name: "Heart rate chart",
      ok: !!element("heartChart")
    },
    {
      name: "Personal baseline",
      ok: state.baseline.ready
    },
    {
      name: "Mission sample recording",
      ok: skinMission.totalReceived > 0
    },
    {
      name: "Browser storage available",
      ok: (() => {
        try {
          const key = "vs_storage_test";
          localStorage.setItem(key, "1");
          localStorage.removeItem(key);
          return true;
        } catch (_) {
          return false;
        }
      })()
    }
  ];
}

function renderSystemCheck() {
  const panel = createPanel(
    "systemCheckPanel",
    "SKIN-SYSTEM CHECK | TECHNICAL STATUS"
  );

  const content = panelContent(
    panel,
    "systemCheckContent"
  );

  systemCheckResults().forEach(item => {
    paragraph(
      content,
      (item.ok ? "PASS" : "CHECK") +
      " | " + item.name,
      item.ok ? "#4ade80" : "#facc15"
    );
  });

  paragraph(
    content,
    "Invalid messages: " + skinSystem.invalidMessages
  );

  if (skinSystem.lastError) {
    paragraph(
      content,
      "Last software error: " + skinSystem.lastError,
      "#f87171"
    );
  }

  button(
    content,
    "RUN SYSTEM CHECK",
    renderSystemCheck
  );

  button(
    content,
    "EXPORT SYSTEM DIAGNOSTICS",
    () => downloadJSON(
      {
        version: VS.version,
        timestamp: nowISO(),
        checks: systemCheckResults(),
        connectionLosses: skinSystem.connectionLosses,
        invalidMessages: skinSystem.invalidMessages,
        lastError: skinSystem.lastError
      },
      "VIRTUAL_SKIN_DIAGNOSTICS.json"
    )
  );
}

// ==================================================
// RESEARCH DOCUMENTATION PANEL
// ==================================================

function renderAboutPanel() {
  const panel = createPanel(
    "aboutPanel",
    "ABOUT VIRTUAL SKIN | RESEARCH PROTOTYPE"
  );

  const content = panelContent(
    panel,
    "aboutContent"
  );

  paragraph(
    content,
    "VIRTUAL SKIN is a simulated astronaut health " +
    "monitoring and decision-support prototype."
  );

  heading(content, "MISSION OBJECTIVE");

  paragraph(
    content,
    "Support astronaut awareness of physiological " +
    "changes during long-duration missions through " +
    "monitoring, interpretable alerts and documented " +
    "crew responses."
  );

  heading(content, "SYSTEM ARCHITECTURE");

  paragraph(
    content,
    "Simulated potentiometers → ESP32 (Wokwi) → " +
    "MQTT broker → CodePen dashboard → " +
    "analysis → incidents → crew decisions → reports."
  );

  heading(content, "CURRENT CAPABILITIES");

  paragraph(
    content,
    "Three simulated indicators, real-time dashboard, " +
    "personal baseline, activity context, rule-based " +
    "analysis, incident history, decision checklist, " +
    "mission reports and local persistence."
  );

  heading(content, "FUTURE DEVELOPMENT");

  paragraph(
    content,
    "Physical wearable sensors, secure communications, " +
    "validated physiological models, onboard storage, " +
    "offline-first processing, hardware testing and " +
    "human-factors evaluation."
  );

  heading(content, "IMPORTANT LIMITATIONS");

  paragraph(
    content,
    "NOT A MEDICAL DEVICE. NOT CLINICALLY VALIDATED. " +
    "NOT FLIGHT QUALIFIED. SIMULATED PHYSIOLOGICAL DATA. " +
    "NO TRAINED AI MODEL.",
    "#facc15"
  );
}

// ==================================================
// PANEL REFRESH
// ==================================================

function refreshPanels() {
  [
    ["Dashboard", updateDashboard],
    ["Intelligence", renderIntelligencePanel],
    ["Baseline", renderBaselinePanel],
    ["Context", renderContextPanel],
    ["Safety", renderSafetyPanel],
    ["Decision", renderDecisionPanel],
    ["Mission", renderMissionPanel],
    ["Mission Control", renderMissionControl],
    ["Demo", renderDemoPanel],
    ["System Check", renderSystemCheck]
  ].forEach(([name, fn]) => {
    safeUpdate(name, fn);
  });
}

// ==================================================
// CLOCK
// ==================================================

function updateClock() {
  setText("clock", new Date().toLocaleTimeString());
}

// ==================================================
// INITIALIZATION
// ==================================================

function initializeVirtualSkin() {
  if (skinSystem.initialized) return;
  skinSystem.initialized = true;

  loadSkinMemory();

  updateClock();

  window.addEventListener("resize", drawChart);

  refreshPanels();
  renderAboutPanel();

  connectMQTT();

  setInterval(updateClock, 1000);
  setInterval(checkTelemetrySafety, 1000);

  startSkinAutosave();

  addEvent(
    "VIRTUAL SKIN 4.0 integrated system initialized"
  );

  console.log(
    "VIRTUAL SKIN 4.0 - READY"
  );
}

// ==================================================
// START - SINGLE ENTRY POINT
// ==================================================

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeVirtualSkin,
    { once: true }
  );
} else {
  initializeVirtualSkin();
}

/*
====================================================
VIRTUAL SKIN 4.1
SKIN-RESILIENCE 2.0

Preserves unresolved incidents during signal loss.
Requires three consecutive stable live samples
before resolving an interrupted incident.

Research prototype - simulated data.
====================================================
*/

const skinResilience = {
  unresolvedIncidentId: null,
  stableConfirmationCount: 0,
  requiredStableSamples: 3,
  signalLostAt: null,
  restoredAt: null
};

// ----------------------------------------------
// Save resilience state separately
// ----------------------------------------------

function saveResilienceMemory() {
  try {
    localStorage.setItem(
      "virtualskin_resilience_v2",
      JSON.stringify({
        unresolvedIncidentId:
          skinResilience.unresolvedIncidentId,
        signalLostAt: skinResilience.signalLostAt,
        savedAt: new Date().toISOString()
      })
    );
  } catch (error) {
    console.warn("Resilience memory unavailable", error);
  }
}

// ----------------------------------------------
// Restore unresolved status
// ----------------------------------------------

function loadResilienceMemory() {
  try {
    const raw = localStorage.getItem(
      "virtualskin_resilience_v2"
    );

    if (!raw) return;

    const saved = JSON.parse(raw);

    if (
      saved &&
      typeof saved.unresolvedIncidentId === "string"
    ) {
      skinResilience.unresolvedIncidentId =
        saved.unresolvedIncidentId;

      skinResilience.signalLostAt =
        saved.signalLostAt || null;

      const incident = skinSafety.incidents.find(
        x => x.id === saved.unresolvedIncidentId
      );

      if (incident) {
        incident.active = true;
        incident.endedAt = null;
        incident.closureReason = null;
        skinSafety.activeIncident = incident;
      }
    }
  } catch (error) {
    console.warn("Resilience restore error", error);
  }
}

// ----------------------------------------------
// Preserve the original functions
// ----------------------------------------------

const originalHandleSignalLoss = handleSignalLoss;
const originalProcessSafetyStatus = processSafetyStatus;
const originalRenderSafetyPanel = renderSafetyPanel;
const originalRenderMissionControl = renderMissionControl;
const originalBuildMissionReport = buildMissionReport;
const originalSaveSkinMemory = saveSkinMemory;

// ----------------------------------------------
// Replace signal-loss handling
// ----------------------------------------------

handleSignalLoss = function(reason) {
  const wasLive = state.telemetryConnected;

  state.telemetryConnected = false;
  skinSafety.warningStart = null;

  if (wasLive) {
    skinSystem.connectionLosses++;

    skinResilience.signalLostAt =
      new Date().toISOString();

    addEvent(
      "SKIN-RESILIENCE: Signal interrupted"
    );
  }

  const active = skinSafety.activeIncident;

  if (active) {
    skinResilience.unresolvedIncidentId = active.id;
    skinResilience.stableConfirmationCount = 0;

    active.communicationInterrupted = true;
    active.unresolvedDueToSignalLoss = true;

    addEvent(
      "SKIN-RESILIENCE: Incident unresolved - " +
      active.id
    );

    saveResilienceMemory();
    saveSkinMemory();
  }

  setConnectionIndicator(reason, "#f87171");
  refreshPanels();
};

// ----------------------------------------------
// Confirm recovery after reconnection
// ----------------------------------------------

processSafetyStatus = function() {
  if (!state.telemetryConnected) return;

  const unresolvedId =
    skinResilience.unresolvedIncidentId;

  if (!unresolvedId) {
    originalProcessSafetyStatus();
    return;
  }

  const status = currentStatus();

  if (status === "stable") {
    skinResilience.stableConfirmationCount++;

    if (
      skinResilience.stableConfirmationCount <
      skinResilience.requiredStableSamples
    ) {
      return;
    }

    const incident = skinSafety.activeIncident;

    if (incident && incident.id === unresolvedId) {
      incident.unresolvedDueToSignalLoss = false;
      incident.recoveryConfirmedAt =
        new Date().toISOString();

      closeSafetyIncident(
        "Recovery observed after three stable samples"
      );
    }

    skinResilience.unresolvedIncidentId = null;
    skinResilience.stableConfirmationCount = 0;
    skinResilience.restoredAt =
      new Date().toISOString();

    saveResilienceMemory();
    saveSkinMemory();

    addEvent(
      "SKIN-RESILIENCE: Stable telemetry confirmed"
    );

    return;
  }

  // A non-stable reading does not confirm recovery.
  skinResilience.stableConfirmationCount = 0;

  const active = skinSafety.activeIncident;

  if (active && active.id === unresolvedId) {
    if (active.status === status) {
      return;
    }

    active.unresolvedDueToSignalLoss = false;

    closeSafetyIncident(
      "Superseded by new observed condition"
    );
  }

  skinResilience.unresolvedIncidentId = null;
  saveResilienceMemory();

  originalProcessSafetyStatus();
};

// ----------------------------------------------
// Extend the safety interface
// ----------------------------------------------

renderSafetyPanel = function() {
  originalRenderSafetyPanel();

  const content = element("safetyContent");
  if (!content) return;

  if (skinResilience.unresolvedIncidentId) {
    heading(
      content,
      "SKIN-RESILIENCE | UNRESOLVED CONDITION"
    );

    paragraph(
      content,
      "The previous incident has not been confirmed " +
      "as resolved. Communication was interrupted.",
      "#f87171"
    );

    paragraph(
      content,
      "Incident ID: " +
      skinResilience.unresolvedIncidentId
    );

    paragraph(
      content,
      "Recovery confirmation: " +
      skinResilience.stableConfirmationCount +
      "/" +
      skinResilience.requiredStableSamples +
      " consecutive stable readings"
    );

    paragraph(
      content,
      "The last known condition must not be treated " +
      "as a current physiological measurement.",
      "#facc15"
    );
  }
};

// ----------------------------------------------
// Extend Mission Control
// ----------------------------------------------

renderMissionControl = function() {
  originalRenderMissionControl();

  const content = element("missionControlContent");
  if (!content) return;

  heading(content, "COMMUNICATION RESILIENCE");

  paragraph(
    content,
    "UNRESOLVED INCIDENT: " +
    (skinResilience.unresolvedIncidentId
      ? skinResilience.unresolvedIncidentId
      : "NONE"),
    skinResilience.unresolvedIncidentId
      ? "#f87171"
      : "#4ade80"
  );

  paragraph(
    content,
    "LAST SIGNAL LOSS: " +
    (skinResilience.signalLostAt
      ? formatTime(skinResilience.signalLostAt)
      : "NONE")
  );
};

// ----------------------------------------------
// Extend the mission report
// ----------------------------------------------

buildMissionReport = function() {
  const report = originalBuildMissionReport();

  report.resilience = {
    unresolvedIncidentId:
      skinResilience.unresolvedIncidentId,

    lastSignalLoss:
      skinResilience.signalLostAt,

    lastConfirmedRestoration:
      skinResilience.restoredAt,

    recoveryConfirmationSamples:
      skinResilience.requiredStableSamples,

    note:
      "Stable samples confirm only recovery of " +
      "the simulated readings, not medical recovery."
  };

  return report;
};

// ----------------------------------------------
// Keep resilience memory synchronized
// ----------------------------------------------

saveSkinMemory = function() {
  const result = originalSaveSkinMemory();
  saveResilienceMemory();
  return result;
};

// ----------------------------------------------
// Initialize the extension
// ----------------------------------------------

loadResilienceMemory();

if (skinSystem.initialized) {
  refreshPanels();
}

console.log(
  "SKIN-RESILIENCE 2.0 MODULE LOADED"
);

/*
=================================================
VIRTUAL SKIN 4.2
SKIN-EXPLAIN
SKIN-TIMELINE
SKIN-QUALITY

Requires VIRTUAL SKIN 4.0.
Compatible with the SKIN-RESILIENCE 2.0 extension.
=================================================
*/

// ================================================
// SKIN-EXPLAIN
// ================================================

function explainParameter(
  name,
  value,
  unit,
  criticalLow,
  warningLow,
  warningHigh,
  criticalHigh
) {
  if (criticalLow !== null && value < criticalLow) {
    return {
      severity: "EMERGENCY",
      text:
        `${name}: ${value.toFixed(1)} ${unit} ` +
        `is below the critical threshold of ` +
        `${criticalLow} ${unit}.`
    };
  }

  if (criticalHigh !== null && value > criticalHigh) {
    return {
      severity: "EMERGENCY",
      text:
        `${name}: ${value.toFixed(1)} ${unit} ` +
        `exceeds the critical threshold of ` +
        `${criticalHigh} ${unit}.`
    };
  }

  if (warningLow !== null && value < warningLow) {
    return {
      severity: "WARNING",
      text:
        `${name}: ${value.toFixed(1)} ${unit} ` +
        `is below the warning threshold of ` +
        `${warningLow} ${unit}.`
    };
  }

  if (warningHigh !== null && value > warningHigh) {
    return {
      severity: "WARNING",
      text:
        `${name}: ${value.toFixed(1)} ${unit} ` +
        `exceeds the warning threshold of ` +
        `${warningHigh} ${unit}.`
    };
  }

  return null;
}

function generateAlertExplanation() {
  if (!state.telemetryConnected) {
    return [{
      severity: "SIGNAL LOST",
      text:
        "Live telemetry is unavailable. " +
        "Current physiological status cannot be determined."
    }];
  }

  if (!state.valid) {
    return [{
      severity: "SENSOR ERROR",
      text:
        "The ESP32 reported invalid acquisition data."
    }];
  }

  const t = VS.thresholds;
  const explanations = [];

  const checks = [
    explainParameter(
      "Heart rate",
      state.hr,
      "BPM",
      t.hr.criticalLow,
      t.hr.low,
      t.hr.high,
      t.hr.criticalHigh
    ),

    explainParameter(
      "Oxygen saturation",
      state.spo2,
      "%",
      t.spo2.criticalLow,
      t.spo2.low,
      null,
      null
    ),

    explainParameter(
      "Respiratory rate",
      state.rr,
      "RPM",
      t.rr.criticalLow,
      t.rr.low,
      t.rr.high,
      t.rr.criticalHigh
    )
  ];

  checks.forEach(item => {
    if (item) explanations.push(item);
  });

  if (
    currentStatus() === "emergency" &&
    !explanations.some(
      x => x.severity === "EMERGENCY"
    )
  ) {
    explanations.push({
      severity: "EMERGENCY",
      text:
        "The ESP32 reported an emergency condition " +
        "without a corresponding critical value in " +
        "the received measurements. This may indicate " +
        "the emergency button was activated."
    });
  }

  if (!explanations.length) {
    explanations.push({
      severity: "STABLE",
      text:
        "All three indicators are within the " +
        "configured demonstration thresholds."
    });
  }

  return explanations;
}

function renderExplainPanel() {
  const panel = createPanel(
    "explainPanel",
    "SKIN-EXPLAIN | ALERT EXPLANATION"
  );

  const content = panelContent(
    panel,
    "explainContent"
  );

  paragraph(
    content,
    "Current status: " +
    currentStatus().toUpperCase()
  );

  generateAlertExplanation().forEach(item => {
    const color =
      item.severity === "EMERGENCY"
        ? "#f87171"
        : item.severity === "WARNING"
          ? "#facc15"
          : item.severity === "STABLE"
            ? "#4ade80"
            : "#facc15";

    paragraph(
      content,
      item.severity + " | " + item.text,
      color
    );
  });

  paragraph(
    content,
    "Explanations describe configured rules. " +
    "They are not medical diagnoses.",
    "#94a3b8"
  );
}

// ================================================
// SKIN-TIMELINE
// ================================================

function buildTimeline() {
  const incidents = skinSafety.incidents.map(x => ({
    timestamp: x.startedAt,
    type: "INCIDENT",
    description:
      `${x.status.toUpperCase()} opened: ${x.reason}`
  }));

  const closures = skinSafety.incidents
    .filter(x => x.endedAt)
    .map(x => ({
      timestamp: x.endedAt,
      type: "INCIDENT CLOSED",
      description:
        `${x.id}: ${x.closureReason || "Closed"}`
    }));

  const decisions = skinDecision.records.map(x => ({
    timestamp: x.timestamp,
    type: "CREW RESPONSE",
    description:
      `${x.incidentId}: ` +
      `${x.completedSteps.length}/${x.totalSteps} ` +
      "checklist steps documented"
  }));

  return [
    ...incidents,
    ...closures,
    ...decisions
  ]
    .filter(x =>
      Number.isFinite(Date.parse(x.timestamp))
    )
    .sort(
      (a, b) =>
        Date.parse(b.timestamp) -
        Date.parse(a.timestamp)
    );
}

function renderTimelinePanel() {
  const panel = createPanel(
    "timelinePanel",
    "SKIN-TIMELINE | MISSION EVENT HISTORY"
  );

  const content = panelContent(
    panel,
    "timelineContent"
  );

  const timeline = buildTimeline();

  paragraph(
    content,
    "Recorded timeline entries: " + timeline.length
  );

  if (!timeline.length) {
    paragraph(
      content,
      "No incidents or crew responses recorded."
    );
    return;
  }

  timeline.slice(0, 15).forEach(item => {
    paragraph(
      content,
      formatTime(item.timestamp) +
      " | " +
      item.type +
      " | " +
      item.description
    );
  });

  button(
    content,
    "EXPORT TIMELINE",
    () => downloadJSON(
      {
        project: "VIRTUAL SKIN",
        exportedAt: nowISO(),
        timeline
      },
      "VIRTUAL_SKIN_TIMELINE.json"
    )
  );
}

// ================================================
// SKIN-QUALITY
// ================================================

const skinQuality = {
  received: 0,
  firstReceivedAt: null,
  lastReceivedAt: null,
  intervals: [],
  maximumIntervals: 100
};

function registerTelemetryQuality() {
  const now = Date.now();

  if (skinQuality.lastReceivedAt !== null) {
    const interval = now - skinQuality.lastReceivedAt;

    skinQuality.intervals.push(interval);

    skinQuality.intervals =
      skinQuality.intervals.slice(
        -skinQuality.maximumIntervals
      );
  }

  if (skinQuality.firstReceivedAt === null) {
    skinQuality.firstReceivedAt = now;
  }

  skinQuality.lastReceivedAt = now;
  skinQuality.received++;
}

function qualityStatistics() {
  const intervals = skinQuality.intervals;

  return {
    received: skinQuality.received,
    meanIntervalMs: intervals.length
      ? mean(intervals)
      : null,
    maxIntervalMs: intervals.length
      ? Math.max(...intervals)
      : null,
    connectionLosses: skinSystem.connectionLosses,
    invalidMessages: skinSystem.invalidMessages,
    live: state.telemetryConnected
  };
}

function renderQualityPanel() {
  const panel = createPanel(
    "qualityPanel",
    "SKIN-QUALITY | TELEMETRY PERFORMANCE"
  );

  const content = panelContent(
    panel,
    "qualityContent"
  );

  const q = qualityStatistics();

  paragraph(
    content,
    "Connection: " +
    (q.live ? "LIVE" : "UNAVAILABLE"),
    q.live ? "#4ade80" : "#f87171"
  );

  paragraph(
    content,
    "Received valid-format messages: " + q.received
  );

  paragraph(
    content,
    "Average arrival interval: " +
    (q.meanIntervalMs === null
      ? "Collecting data"
      : q.meanIntervalMs.toFixed(0) + " ms")
  );

  paragraph(
    content,
    "Maximum observed interval: " +
    (q.maxIntervalMs === null
      ? "Collecting data"
      : q.maxIntervalMs.toFixed(0) + " ms")
  );

  paragraph(
    content,
    "Connection interruptions: " +
    q.connectionLosses
  );

  paragraph(
    content,
    "Rejected messages: " +
    q.invalidMessages
  );

  paragraph(
    content,
    "Intervals are measured at the browser. " +
    "They include network and scheduling delays " +
    "and are not a measurement of sensor accuracy.",
    "#94a3b8"
  );
}

// ================================================
// INTEGRATION WITH EXISTING FUNCTIONS
// ================================================

const originalProcessTelemetry42 = processTelemetry;
const originalRefreshPanels42 = refreshPanels;
const originalBuildMissionReport42 = buildMissionReport;

processTelemetry = function(data) {
  if (validateTelemetry(data)) {
    registerTelemetryQuality();
  }

  return originalProcessTelemetry42(data);
};

refreshPanels = function() {
  originalRefreshPanels42();

  safeUpdate(
    "SKIN-EXPLAIN",
    renderExplainPanel
  );

  safeUpdate(
    "SKIN-TIMELINE",
    renderTimelinePanel
  );

  safeUpdate(
    "SKIN-QUALITY",
    renderQualityPanel
  );
};

buildMissionReport = function() {
  const report = originalBuildMissionReport42();

  report.explainability = {
    currentExplanations:
      generateAlertExplanation()
  };

  report.timeline = buildTimeline();

  report.telemetryQuality =
    qualityStatistics();

  return report;
};

// ================================================
// START EXTENSION
// ================================================

if (skinSystem.initialized) {
  refreshPanels();
}

console.log(
  "VIRTUAL SKIN 4.2 EXTENSIONS LOADED"
);
