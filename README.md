# Meteor trajectory visualizers

Developed by Etienne Gavazzi, Juha Vierinen, and Daniel Kastinen (2024). 

This repository contains both a Julia version and a JavaScript/WebGL version of
the meteor orbit visualizer. The JavaScript version is online at
<https://juha.no/meteors/>. The visualizations are based on MAARSY meteor head
echo measurements from 2016-2026.

# Example

![MAARSY meteor orbit visualizer showing the Geminids](docs/meteor-viz-screenshot.png)

# JavaScript Web Visualizer

The WebGL visualizer lives in `web/` and uses an embedded export of the MAARSY
meteor orbit catalogue. It animates meteor and planet orbits from Keplerian
elements in JavaScript, with WebGL rendering. The Tycho-2 catalogue is used to
render the background stars. The IAU Meteor Data Center meteor shower database
is used for meteor shower definitions, and Minor Planet Center orbit catalogues
are used for the orbital elements of meteor shower parent bodies.

Open the single-file standalone page directly in a browser:

```sh
xdg-open web/standalone.html
```

The GUI includes color selection, playback speed, trail length, alpha, point
size, a 0 to 100 AU axis-limit slider, and filters for the displayed orbital
parameters.

Regenerate the embedded browser data after changing the reduced HDF5 file:

```sh
python export_web_data.py
python build_standalone.py
```
