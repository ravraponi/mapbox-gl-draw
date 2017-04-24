const CommonSelectors = require('../lib/common_selectors');
const Polygon = require('../feature_types/polygon');
const doubleClickZoom = require('../lib/double_click_zoom');
const Constants = require('../constants');
const isEventAtCoordinates = require('../lib/is_event_at_coordinates');
const createVertex = require('../lib/create_vertex');
const snapTo = require('../lib/snap_to');

module.exports = function(ctx) {

  const polygon = new Polygon(ctx, {
    type: Constants.geojsonTypes.FEATURE,
    properties: {},
    geometry: {
      type: Constants.geojsonTypes.POLYGON,
      coordinates: [[]]
    }
  });
  let currentVertexPosition = 0;
  let heardMouseMove = false;

  if (ctx._test) ctx._test.polygon = polygon;

  ctx.store.add(polygon);

  let snapClickPoint;
  let snapOverSources = ctx.options.snapOverSources;

  return {
    start() {
      ctx.store.clearSelected();
      doubleClickZoom.disable(ctx);
      ctx.ui.queueMapClasses({ mouse: Constants.cursors.ADD });
      ctx.ui.setActiveButton(Constants.types.POLYGON);
      this.on('mousemove', CommonSelectors.true, e => {
        let evt = e;

        if (evt.point && ctx.options.snapTo) {
          evt = snapTo(evt, ctx, polygon.id, snapOverSources);
          if (JSON.stringify(ctx.options.snapOverSources) !== JSON.stringify(snapOverSources)) {
            snapOverSources = ctx.options.snapOverSources;
          }
        }
        snapClickPoint = evt;
        polygon.updateCoordinate(`0.${currentVertexPosition}`, evt.lngLat.lng, evt.lngLat.lat);
        if (CommonSelectors.isVertex(evt)) {
          ctx.ui.queueMapClasses({ mouse: Constants.cursors.POINTER });
        }
        heardMouseMove = true;
      });
      this.on('click', CommonSelectors.true, clickAnywhere);
      this.on('click', CommonSelectors.isVertex, clickOnVertex);
      this.on('tap', CommonSelectors.true, clickAnywhere);
      this.on('tap', CommonSelectors.isVertex, clickOnVertex);

      function clickAnywhere(e) {
        const evt = snapClickPoint || e;
        if (currentVertexPosition > 0 && isEventAtCoordinates(evt, polygon.coordinates[0][currentVertexPosition - 1])) {
          return ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, { featureIds: [polygon.id] });
        }
        ctx.ui.queueMapClasses({ mouse: Constants.cursors.ADD });
        polygon.updateCoordinate(`0.${currentVertexPosition}`, evt.lngLat.lng, evt.lngLat.lat);
        currentVertexPosition++;
      }
      function clickOnVertex() {
        return ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, { featureIds: [polygon.id] });
      }
      this.on('keyup', CommonSelectors.isEscapeKey, () => {
        ctx.store.delete([polygon.id], { silent: true });
        ctx.events.changeMode(Constants.modes.SIMPLE_SELECT);
      });
      this.on('keyup', CommonSelectors.isEnterKey, () => {
        ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, { featureIds: [polygon.id] });
      });
      ctx.events.actionable({
        combineFeatures: false,
        uncombineFeatures: false,
        trash: true
      });
    },

    stop: function() {
      ctx.ui.queueMapClasses({ mouse: Constants.cursors.NONE });
      doubleClickZoom.enable(ctx);
      ctx.ui.setActiveButton();

      // check to see if we've deleted this feature
      if (ctx.store.get(polygon.id) === undefined) return;

      //remove last added coordinate
      polygon.removeCoordinate(`0.${currentVertexPosition}`);
      if (ctx.options.snapTo) {
        ctx.options.snapOverStyles.forEach(style => {
          if (ctx.map.getLayer(style.id) !== undefined) {
            ctx.map.removeLayer(style.id);
          }
        });
      }
      if (polygon.isValid()) {
        ctx.map.fire(Constants.events.CREATE, {
          features: [polygon.toGeoJSON()]
        });
      } else {
        ctx.store.delete([polygon.id], { silent: true });
        ctx.events.changeMode(Constants.modes.SIMPLE_SELECT, {}, { silent: true });
      }
    },

    render(geojson, callback) {
      const isActivePolygon = geojson.properties.id === polygon.id;
      geojson.properties.active = (isActivePolygon) ? Constants.activeStates.ACTIVE : Constants.activeStates.INACTIVE;
      if (!isActivePolygon) return callback(geojson);

      // Don't render a polygon until it has two positions
      // (and a 3rd which is just the first repeated)
      if (geojson.geometry.coordinates.length === 0) return;

      const coordinateCount = geojson.geometry.coordinates[0].length;

      // If we have fewer than two positions (plus the closer),
      // it's not yet a shape to render
      if (coordinateCount < 3) return;

      geojson.properties.meta = Constants.meta.FEATURE;

      if (coordinateCount > 4) {
        // Add a start position marker to the map, clicking on this will finish the feature
        // This should only be shown when we're in a valid spot
        callback(createVertex(polygon.id, geojson.geometry.coordinates[0][0], '0.0', false));
        const endPos = geojson.geometry.coordinates[0].length - 3;
        callback(createVertex(polygon.id, geojson.geometry.coordinates[0][endPos], `0.${endPos}`, false));
      }

      // If we have more than two positions (plus the closer),
      // render the Polygon
      if (coordinateCount > 3) {
        return callback(geojson);
      }

      // If we've only drawn two positions (plus the closer),
      // make a LineString instead of a Polygon
      const lineCoordinates = [
        [geojson.geometry.coordinates[0][0][0], geojson.geometry.coordinates[0][0][1]], [geojson.geometry.coordinates[0][1][0], geojson.geometry.coordinates[0][1][1]]
      ];
      return callback({
        type: Constants.geojsonTypes.FEATURE,
        properties: geojson.properties,
        geometry: {
          coordinates: lineCoordinates,
          type: Constants.geojsonTypes.LINE_STRING
        }
      });
    },
    trash() {
      if (currentVertexPosition > 1) {
        let cursorPosition = polygon.getCoordinate(`0.${currentVertexPosition}`);

        if (cursorPosition === undefined && heardMouseMove === true) {
          //a mousemove event has not recently happened so mimic one
          cursorPosition = polygon.getCoordinate(`0.${currentVertexPosition - 1}`);
          polygon.updateCoordinate(`0.${currentVertexPosition}`, cursorPosition[0], cursorPosition[1]);
        }
        if (cursorPosition !== undefined && heardMouseMove === false) {
          //should be a touch which has no mousemove
          polygon.removeCoordinate(`0.${currentVertexPosition}`);
          currentVertexPosition--;
        }
        //remove last added coordinate
        currentVertexPosition--;
        polygon.removeCoordinate(`0.${currentVertexPosition}`);
      } else {
        ctx.store.delete([polygon.id], { silent: true });
        ctx.events.changeMode(Constants.modes.SIMPLE_SELECT);
      }
    }
  };
};
