VIRTUAL SKIN

Monitoring That Becomes Part of You

NASA Space Apps Challenge 2026

Created by: María José Cuervo Grajales

Team: VIRTUAL SKIN — Solo Participant

**ABOUT THE PROJECT**

VIRTUAL SKIN is an interactive astronaut health monitoring and decision-support prototype that I developed to explore how technology could help astronauts better understand their health during long-duration space missions.

The idea came from a simple question: what if astronauts could do more than just look at their vital signs? What if they could understand changes, recognize potential problems, and document their responses through one accessible system?

My prototype monitors three simulated physiological indicators: heart rate, oxygen saturation, and respiratory rate.

Instead of simply displaying numbers, VIRTUAL SKIN detects unusual readings, explains why an alert was triggered, supports structured crew responses, and records important events.

**HOW TO TRY VIRTUAL SKIN**

Live Dashboard: https://codepen.io/editor/iuoqwgxb-the-selector/pen/01a1e15a-ca0f-707f-b78c-9742188c3667

ESP32 Simulation: https://wokwi.com/projects/480730527939332097

To test the prototype:

1. Open the Wokwi simulation using the link above.
2. Click the green Play button to start the ESP32 simulation.
3. Open the VIRTUAL SKIN dashboard in another browser tab.
4. Wait for the dashboard to establish its MQTT connection and receive telemetry.
5. Adjust the three potentiometers to simulate changes in heart rate, oxygen saturation, and respiratory rate.
6. Observe how the dashboard responds to stable, warning, and emergency conditions.
7. Explore the alert explanations, crew response checklist, incident timeline, and mission reports.

**EXAMPLE TEST SCENARIOS**

Stable condition:

Heart rate: 76 BPM

Oxygen saturation: 98%

Respiratory rate: 16 breaths/min

Warning condition:

Heart rate: 110 BPM

Oxygen saturation: 98%

Respiratory rate: 16 breaths/min

Emergency condition:

Heart rate: 135 BPM

Oxygen saturation: 86%

Respiratory rate: 29 breaths/min

These are simulated values used to demonstrate the system. They are not clinical recommendations.

**HOW THE SYSTEM WORKS**

VIRTUAL SKIN connects a simulated ESP32 microcontroller in Wokwi to a web-based monitoring dashboard.

Three potentiometers represent physiological measurements. The ESP32 processes the simulated inputs and transmits the information through MQTT.

The dashboard, developed using HTML, CSS, and JavaScript, receives the measurements and evaluates them using predefined rules.

When a measurement crosses a configured threshold, VIRTUAL SKIN identifies the condition, explains the alert, and records the event.

The system also allows the user to document actions taken during an incident and export mission reports.

**MAIN FEATURES**

Real-time simulated physiological monitoring.

Warning and emergency detection.

Explainable alerts.

Personal baseline measurements.

Manual activity context.

Crew response checklist.

Incident history and timeline.

Communication-loss detection.

Telemetry performance monitoring.

Mission report generation and JSON export.

**TECHNOLOGIES USED**

ESP32

Wokwi

HTML, CSS, and JavaScript

CodePen

MQTT and MQTT.js

EMQX public MQTT broker

Browser localStorage

GitHub

**THE FUTURE WEARABLE CONCEPT**

Although VIRTUAL SKIN currently operates as a software simulation, my long-term vision is to connect it to a lightweight wearable system.

This future device could integrate physical sensors for cardiac activity, oxygen saturation, and respiratory rate.

An embedded processing unit would collect the sensor information and transmit it to the monitoring software.

My goal is to explore a system that could become part of what astronauts wear, providing useful health information without creating an additional burden.

The wearable remains a concept. It has not been manufactured or validated for spaceflight.

**TESTING AND VALIDATION**

I tested VIRTUAL SKIN through simulated scenarios involving stable measurements, warnings, emergencies, crew responses, communication interruptions, reconnection, and recovery.

These manual tests helped me verify that the prototype behaved as expected in its simulation environment.

The results do not establish medical accuracy, cybersecurity assurance, or readiness for operational space missions.

**CURRENT LIMITATIONS**

All physiological measurements are simulated.

The detection thresholds are experimental and have not been clinically validated.

The prototype requires an Internet connection and uses a public MQTT broker.

The system does not provide medical diagnoses or treatment recommendations.

VIRTUAL SKIN is an educational research prototype, not a medical device.

**FUTURE DEVELOPMENT**

My next steps would be to explore physical biosensors, secure communication, offline processing, wearable ergonomics, improved reliability, and technical validation.

I hope VIRTUAL SKIN can eventually contribute to research on more accessible and autonomous astronaut health monitoring.

**NASA RESOURCES AND REFERENCES**

NASA Human Research Program:

https://www.nasa.gov/humans-in-space/human-research-program/

Wokwi:

https://wokwi.com/

CodePen:

https://codepen.io/

MQTT.js:

https://github.com/mqttjs/MQTT.js

EMQX:

https://www.emqx.com/

Only resources actually consulted or used should be listed as project references.

**ARTIFICIAL INTELLIGENCE DISCLOSURE**

I used ChatGPT as an assistant during the development of VIRTUAL SKIN.

It supported programming, debugging, documentation, and presentation preparation.

I integrated the prototype, carried out manual simulation tests, and reviewed the system's functionality.

The monitoring software uses rule-based logic rather than a trained artificial intelligence model.

Any AI-generated concept illustrations are identified as such.

**FINAL THOUGHT**

VIRTUAL SKIN began with the idea that astronauts should not have to face complex health information alone.

I wanted to create something that could make monitoring more understandable, organized, and useful.

This prototype is only a first step, but it represents my vision of a future where technology becomes a natural part of caring for astronaut health.

VIRTUAL SKIN — Monitoring That Becomes Part of You.
