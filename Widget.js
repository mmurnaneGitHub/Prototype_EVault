///////////////////////////////////////////////////////////////////////////
// Copyright © 2014 - 2017 Esri. All Rights Reserved.
//
// Licensed under the Apache License Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
///////////////////////////////////////////////////////////////////////////

define([
  'dojo/_base/declare',
  'dojo/_base/lang',
  'dojo/on',
  './Utils',
  'dojo/promise/all', //MJM
  'dojo/_base/array', //MJM
  'jimu/CSVUtils', //MJM
  'esri/tasks/BufferParameters', 'esri/tasks/GeometryService',  //MJM
  'dijit/TitlePane', //MJM - collapsible bar to hold details
  'esri/graphic',  //MJM
  'dijit/form/Button',  //MJM
  'esri/toolbars/draw', //MJM
  'esri/symbols/SimpleFillSymbol', //MJM
  'esri/geometry/geometryEngine',  //MJM
  'esri/tasks/query',  //MJM
  'esri/tasks/QueryTask',  //MJM
  'dojo/dom-construct',  //MJM
  'esri/symbols/SimpleFillSymbol',  //MJM
  'esri/symbols/SimpleLineSymbol',  //MJM
  'esri/symbols/SimpleMarkerSymbol',  //MJM
  'esri/Color',  //MJM
  'dijit/_WidgetsInTemplateMixin',
  'jimu/BaseWidget'
], function (declare, lang, on, legendUtils,
  all, array, CSVUtils, BufferParameters, GeometryService,
  TitlePane, Graphic, Button, Draw, SimpleFillSymbol, geometryEngine, Query, QueryTask, domConstruct,
  SimpleFillSymbol, SimpleLineSymbol, SimpleMarkerSymbol, Color,
  _WidgetsInTemplateMixin, BaseWidget) {

  var clazz = declare([BaseWidget, _WidgetsInTemplateMixin], {
    name: 'Legend',
    baseClass: 'jimu-widget-legend',
    legend: null,
    _jimuLayerInfos: null,

    startup: function () {
      this.inherited(arguments);
      this._buildDrawSection();  //MJM - Add Draw section to panel
      this._buildDocumentSection();  //MJM - Add Permit History & Feature Drawings sections to panel
      this._createButtonCSV();  //MJM - Start Over Button
    },

    onOpen: function () {
      //this._jimuLayerInfos = LayerInfos.getInstanceSync();
      if (this.toolbar) {
        this.toolbar.activate(Draw['POLYGON']);  //MJM - enable map draw ability
      }
    },

    onClose: function () {
      //this.legend.destroy();
      this.toolbar.deactivate();  //MJM - disable draw ability on widget close
    },

    //START MJM FUNCTIONS ------------------------------------------------------------------------------
    _buildDrawSection: function () {  //MJM - Draw & Query setup
      //GLOBAL VARIABLES (no var)
      myMapSR = this.map.spatialReference;
      checkPH = checkFD = false;  //Set to false until each CSV file is ready
      currentAddressResults = [];  //Object to hold CSV records for Permit History
      currentStreetResults = [];  //Object to hold CSV records for Feature Drawings
      currentAllResults = [];  //Object to hold CSV records for Permit History & Feature Drawings
      highlightResults_Address = [];  //object to hold feature boundaries for highlighting - all other data
      highlightResults = [];  //object to hold feature boundaries for highlighting - all other data
      //Highlight graphic symbols
      symbol_Highlight = new SimpleFillSymbol(SimpleFillSymbol.STYLE_SOLID, SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([0, 0, 255]), 2), new Color([255, 255, 0, 0.25]));
      symbol_Highlight_Pt = new SimpleMarkerSymbol(SimpleMarkerSymbol.STYLE_SQUARE, 14,
        new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID,
          new Color([0, 0, 255]), 1),
        new Color([0, 0, 255, 0.25]));

      //Query layer - Parcel (base)
      qtParcel = new QueryTask("https://gis.cityoftacoma.org/arcgis/rest/services/PDS/DARTparcels_PUBLIC/MapServer/4");  //ALL Parcels - To avoid the rare occasion when there is no base parcel
      qParcel = new Query();
      qParcel.returnGeometry = true;
      qParcel.outFields = ["TaxParcelNumber", "Site_Address"];  //Parcel return fields

      //Buffer parcel setup ----------------------------------
      esri.config.defaults.io.proxyUrl = "/website/DART/StaffMap/proxy/proxy.ashx";  //Public proxy page for large buffers (post) ---Geometry Service - may need proxy for larger polys
      esri.config.defaults.io.alwaysUseProxy = false;
      gsvc = new GeometryService("https://gis.cityoftacoma.org/arcgis/rest/services/Utilities/Geometry/GeometryServer");  //Can't use clent-side yet (esri/geometry/GeometryEngine) to buffer geometries with a geographic coordinate system other than WGS-84 (wkid: 4326)
      paramsBuffer = new BufferParameters();
      paramsBuffer.unionResults = true;  //Need one polygon for address point query task
      paramsBuffer.distances = [0]; //Required, but can be 0 - Using the buffer function to make on polygon out of many parcels
      paramsBuffer.bufferSpatialReference = new esri.SpatialReference({
        wkid: 102100
      });
      paramsBuffer.outSpatialReference = myMapSR;
      paramsBuffer.unit = esri.tasks.GeometryService["UNIT_FOOT"];
      //---end Geometry Service - for buffer

      qtAddress = new QueryTask("https://gis.cityoftacoma.org/arcgis/rest/services/PDS/DARTquery_WAB_PUBLIC/MapServer/1");  //Address Points - Permit History
      qAddress = new Query();
      qAddress.returnGeometry = true;
      qAddress.outFields = ["MAPTIP"];  //Address point return fields
      qAddress.orderByFields = ["MAPTIP"];  //Sort field

      qtStreet = new QueryTask("https://gis.cityoftacoma.org/arcgis/rest/services/PDS/DARTquery_WAB_PUBLIC/MapServer/21");  //Streets - Feature Drawings
      qStreet = new Query();
      qStreet.returnGeometry = true;
      qStreet.outFields = ["MAPTIP", "BIGID"];  //return fields -   ( alias: E-Vault ) 
      qStreet.orderByFields = ["MAPTIP"];  //Sort field

      new Button({  //Create a button to remove drawn graphic
        label: 'Start Over',
        title: 'Remove drawn area and start over',
        iconClass: 'dijitIconDelete',
        disabled: false,
        onClick: lang.hitch(this, this._drawLimitArea)
      }, "buttonDraw").startup();

      this.map.on("load", this._drawCreateToolbar());  //Create draw toolbar
      this.toolbar.activate(Draw['POLYGON']);  //Enable map polygon draw ability
    },

    _buildDocumentSection: function () {  //MJM - Permit History & Feature Drawings setup
      var tpPermitHistory = new TitlePane({  //Permit History - put an id to dynamically update innerHTML with queries
        title: "<b>Permit History</b>",
        open: false,
        content: "<div id='addressQuery'></div>"
      });
      this.permitHistory.appendChild(tpPermitHistory.domNode);  //data-dojo-attach-point permitHistory
      tpPermitHistory.startup(); //place on page (waits for appendChild step)

      var tpFeatureDrawings = new TitlePane({ //Feature Drawings Section - put an id to dynamically update innerHTML with queries
        title: "<b>Feature Drawings</b>",
        open: false,
        content: "<div id='streetQuery'></div>"
      });
      this.featureDrawings.appendChild(tpFeatureDrawings.domNode);  //data-dojo-attach-point featureDrawings
      tpFeatureDrawings.startup(); //place on page (waits for appendChild step)
    },

    _drawLimitArea: function () {  //MJM - Draw check box and remove button actions
      currentAddressResults = [];  //Empty out object to hold CSV records for Permit History
      currentStreetResults = [];  //Empty out object to hold CSV records for Feature Drawings
      currentAllResults = [];  //Empty out object to hold CSV records for Permit History & Feature Drawings
      this.map.graphics.clear(); //Remove all map graphics
      checkPH = checkFD = false;  //Set to false until each CSV file is ready
      this._toggleButtonCSV("none");  //Hide CSV button until files have been updated
      document.getElementById("addressQuery").innerHTML = ""; //Clear last address point query text - won't exist on intial start up
      document.getElementById("streetQuery").innerHTML = ""; //Clear last street query text
      this.toolbar.activate(Draw['POLYGON']);  //enable map draw ability
    },

    _drawCreateToolbar: function () {  //MJM - add drawing ability
      this.toolbar = new Draw(this.map);
      this.own(on(this.toolbar, "draw-end", lang.hitch(this, this._drawAddToMap))); //run after draw double-click
    },

    _drawAddToMap: function (evt) {  //MJM - Add graphic to map
      this.toolbar.deactivate();  //Disable draw ability
      var graphic = new Graphic(evt.geometry, new SimpleFillSymbol());
      var areaGraphic = geometryEngine.geodesicArea(geometryEngine.simplify(graphic.geometry), "acres");  //Calculate graphic area in acres
      var areaLimit = 200;  //Limit for graphic size
      this.map.graphics.add(graphic);  //Add drawn polygon to map
      if (areaGraphic > areaLimit) {
        alert("Sorry, area drawn is " + areaGraphic.toFixed(2) + " acres.  Please limit query area to " + areaLimit + " acres.")
      } else {
        qParcel.geometry = qStreet.geometry = graphic.geometry;  //Use graphic geometry for parcel & street query
        document.getElementById("addressQuery").innerHTML = "<div><img src='widgets/Evault/images/loading.gif'> Retrieving Permit History records ...</div>"; //Address Section: Add waiting image
        document.getElementById("streetQuery").innerHTML = "<div><img src='widgets/Evault/images/loading.gif'> Retrieving Feature Drawing records ...</div>"; //Street Section: Add waiting image

        qtStreet.execute(qStreet, lang.hitch(this, this._handleQueryStreet), function (err) { console.error("Query Error: " + err.message); }); //STREETS: Trigger a query by drawn polygon, use lang.hitch to keep scope of this, add error catch message
        qtParcel.execute(qParcel, lang.hitch(this, this._handleQueryParcel), function (err) { console.error("Query Error: " + err.message); }); //PARCELS: Trigger a query by drawn polygon, use lang.hitch to keep scope of this, add error catch message

        //Wait for both CSVs to be complete to concatenate into one CSV --------
        checkPH = checkFD = false;  //Set to false until each CSV is ready
        var doneCSV = setInterval(lang.hitch(this, function () {
          if (checkPH && checkFD) {  //Check if CSV files complete
            //JOIN ARRAYS (TEST FOR 0 LENGTH) & MAKE THE CSV BUTTON VISIBLE NOW - START HERE!!!!  REWRITE _createButtonCSV
            currentAllResults = currentAddressResults.concat(currentStreetResults);    //Join two arrays (Permit History & Feature Drawings)
            if (currentAllResults.length>0) {  ////At least one address point or stret segment was found
              this._toggleButtonCSV("block");  //Show CSV button
            }
            clearInterval(doneCSV);  //Stop checking
          }
        }), 100); // check every 100ms
        //---------------------------------------------------------------------
      }
    },

    _toggleButtonCSV: function (toggle) {  //MJM - Hide/Show CSV Button
      var x = document.getElementById("Button_CSV");
      x.style.display = toggle;
    },

    _handleQueryParcel: function (results) {  //MJM - Process parcel query results from drawn polygon
      //BUFFER parcel geometry first before address point query | Use parcel boundaries instead of drawn polygon (more exact) | Assume parcel topologically correct - no need to simplify [geometry]
      if (results.features.length > 0) { //parcels found
        paramsBuffer.geometries = []; //Empty array to hold all parcel geometries
        for (var i = 0; i < results.features.length; i++) {
          paramsBuffer.geometries.push(results.features[i].geometry);  //add each parcel geometry to array
        }
        var bufferedGeometries = gsvc.buffer(paramsBuffer);  //BUFFER the parcels selected
        bufferedGeometries.then(lang.hitch(this, function (results) {  //Using dojo deferred 'then' function to set callback and errback functions
          //QC - Show buffer on map ----------------------------------------------------------
          var symbol = new SimpleFillSymbol();
          var sls = new SimpleLineSymbol(SimpleLineSymbol.STYLE_DASH, new Color([255, 0, 0]), 3);
          symbol.setColor(new Color([100, 100, 100, 0.25]));
          symbol.setOutline(sls);
          var parcelGraphic = new Graphic(results[0], symbol);
          this.map.graphics.add(parcelGraphic);  //Add parcel buffer to map
          this.map.setExtent(parcelGraphic.geometry.getExtent(), true);  // Zoom to buffer extent
          //End QC  -----------------------------------------------------------------

          //Query address points with buffer polygon
          qAddress.geometry = parcelGraphic.geometry;  //Use graphic geometry for parcel & street query
          qtAddress.execute(qAddress, lang.hitch(this, this._handleQueryAddress), function (err) { console.error("Query Error: " + err.message); }); //ADDRESSES: Trigger a query by drawn polygon, use lang.hitch to keep scope of this, add error catch message

        }), lang.hitch(this, function (err) {
          alert("Error retrieving parcel results: " + err.message);
          console.error("Parcel Buffer Error: " + err.message);
        }));
      } else {  //no parcels found
        document.getElementById("addressQuery").innerHTML = 'No address points found ...<br>&nbsp;<br>'; //Update Permit History details | Done here because this._handleQueryAddress will not be run if no parcels within drawn polygon
        checkPH = true;  //Let the setInterval know the Permit History CSV is done (empty)
      }
    },

    _handleQueryAddress: function (results) {  //MJM - Address query results by parcel buffer (0') resulting from drawn polygon
      highlightResults = []; //object to hold feature boundaries for highlighting - empty out
      var highlightIDs = []; //object to hold create dom locations to run highlight boundary function for each layer
      var theFormattedResults = '';
      if (results.features.length == 0) {
        document.getElementById("addressQuery").innerHTML = 'No address points found ...<br>&nbsp;<br>'; //Update Permit History details
        checkPH = true;  //Let the setInterval know the Permit History CSV is done (empty)
      } else if (results.features.length == 1) {
        theFormattedResults += 'One address point found ...<br>&nbsp;<br>'; //Update Permit History details
      } else {
        theFormattedResults += results.features.length + ' address points found ...<br>&nbsp;<br>'; //Update Permit History details
      }
      if (results.features.length > 0) {
        //PERMIT HISTORY
        for (var i = 0; i < results.features.length; i++) {
          theFormattedResults += "&nbsp;&nbsp;<a href=\"https://wsowa.ci.tacoma.wa.us/cot-itd/addressbased/permithistory.aspx?Address=" + results.features[i].attributes['MAPTIP'] + "&Mode=simple\" target=\"_blank\">E-Vault Document(s)</a> for ";
          theFormattedResults += " <span id='Highlight_Address" + i + "'></span><br>&nbsp;<br>";
          highlightIDs.push(results.features[i].attributes['MAPTIP']); //Add geometry info to array for link update later - update each layer highlight field - use later to place Highlight function
          highlightResults.push(results.features[i]); //update with results from each layer - contains geometry for highlighting
        }

        this._Address_format4CSV(results.features, results.fieldAliases);  //Send results to CSV file

        document.getElementById("addressQuery").innerHTML = theFormattedResults; //Update info panel
      }
      for (var i = 0; i < highlightIDs.length; i++) {  //Update field value with highlight function
        var list = dojo.byId("Highlight_Address" + i);  //Add dynamic highlight function to formatted text
        domConstruct.create("span", { innerHTML: "<i><span style='color: blue; cursor: pointer;' title='Highlight address'>" + highlightIDs[i] + "</span></i>" }, list);
        //Method to add click event  - Need this.own to maintain scope of dynamic text function within the popup; lang.hitch to keep scope of function within widget
        this.own(on(list, 'click', lang.hitch(this, this._showFeature, i, 'Address')));  //this.own(on(Node, 'click', lang.hitch(this, FUNCTION, param1, param2, etc)));
      }
    },

    _handleQueryStreet: function (results) {  //MJM - Street query results by drawn polygon
      highlightResults2 = []; //object to hold feature boundaries for highlighting - empty out
      var highlightIDs2 = []; //object to hold create dom locations to run highlight boundary function for each layer
      var theFormattedResults = '';
      if (results.features.length == 0) {
        document.getElementById("streetQuery").innerHTML = 'No street segments found ...<br>&nbsp;<br>'; //
        checkFD = true;  //Let the setInterval know the Feature Drawings CSV is done (empty)
      } else if (results.features.length == 1) {
        theFormattedResults += 'One street segment found ...<br>&nbsp;<br>'; //
      } else {
        theFormattedResults += results.features.length + ' street segments found ...<br>&nbsp;<br>'; //
      }
      if (results.features.length > 0) {
        //FEATURE DRAWINGS
        for (var i = 0; i < results.features.length; i++) {
          theFormattedResults += "&nbsp;&nbsp;<a href=\"http://www.govme.org/gMap/Info/eVaultFilter.aspx?StreetIDs=" + results.features[i].attributes['BIGID'] + "\" target=\"_blank\">E-Vault Document(s)</a> for ";
          theFormattedResults += " <span id='Highlight_Street" + i + "'></span><br>&nbsp;<br>";
          highlightIDs2.push(results.features[i].attributes['MAPTIP']); //update each layer highlight field - use later to place text value for Highlight link function
          highlightResults2.push(results.features[i]); //Add geometry info to array for link update later
        }

        this._Street_format4CSV(results.features, results.fieldAliases);  //Send results to CSV file

        document.getElementById("streetQuery").innerHTML = theFormattedResults; //UPDATE STREET INFO ON PANEL
        for (var i = 0; i < highlightIDs2.length; i++) {  //Update fields within tabs the highlight function
          var list = dojo.byId("Highlight_Street" + i);  //Add dynamic highlight function to formatted text
          domConstruct.create("span", {
            innerHTML: "<i><span style='color: blue; cursor: pointer;' title='Highlight street'>" + highlightIDs2[i] + "</span></i>"
          }, list);
          //Method to add click event  - Need this.own to maintain scope of dynamic text function within the popup; lang.hitch to keep scope of function within widget
          this.own(on(list, 'click', lang.hitch(this, this._showFeature, i, 'Street')));  //this.own(on(Node, 'click', lang.hitch(this, FUNCTION, param1, param2, etc)));
        }
      }
    },

    _showFeature: function (featureNum, type) {  //MJM - highlights data item on map
      this._removeGraphic('identify');  //clear any identify graphic
      if (type == 'Address') {
        var feature = highlightResults[featureNum];  //object to hold feature boundaries for highlighting
      } else {
        var feature = highlightResults2[featureNum];  //object to hold feature boundaries for highlighting
      }
      if (feature.geometry.type == "point") {  //check if feature a point or other type
        feature.setSymbol(symbol_Highlight_Pt); //use marker symbol
      } else {
        feature.setSymbol(symbol_Highlight); //use default symbol
      }
      feature.geometry.spatialReference = myMapSR;  //Set feature's spatial reference so selected layer highlighted correctly
      feature.id = "identify";  //add id for later removal by id
      this.map.graphics.add(feature);  //add graphic to map
    },

    _createButtonCSV: function (array) {  //MJM - Create button that opens results as a CSV file   (see 'Export to CSV file' function - ..\jimu.js\CSVUtils.js)
      //Remove existing button
      var element = document.getElementById("Button_CSV");
      if (element != null) {
        element.parentNode.removeChild(element)
      };
      //Build button
      var node1 = document.createElement("div");
      var textnode1 = document.createTextNode("Selected Documents (click for CSV file)");
      node1.className = "jimu-btn";
      node1.id = "Button_CSV";
      node1.style.display = "none";  //Hide button when CSV has been created, toggle on with this._toggleButtonCSV()
      node1.style.clear = "both";
      node1.appendChild(textnode1);
      //Build blank line
      var node2 = document.createElement("div");
      var br = document.createElement("br");
      node2.style.display = "block";
      node2.style.clear = "both";
      node2.appendChild(br);
      var theElement = document.getElementById("CSV_Button"); //Insert button location
      theElement.insertBefore(node2, theElement.childNodes[0]); //puts button into results-container, but scrolls with parcels 
      theElement.insertBefore(node1, theElement.childNodes[0]); //puts blank line under button 
      //Add click event to button - this.own(on(Node, 'click', lang.hitch(this, FUNCTION, param1, param2, etc)));
      this.own(on(dojo.byId("Button_CSV"), 'click', lang.hitch(this, this._exportCSV))); //this.own(on(Node, 'click', lang.hitch(this, FUNCTION, param1, param2, etc)));
    },

    _Address_format4CSV: function (results, aliases) {  //MJM - Create CSV-style array of with array of results records and array of alias names
      currentAddressResults = [];  //Might do this on Start Over instead!!!
      array.forEach(results, function (record) { //loop through all records & Create array of feature.attributes
        var currentRecord = record.attributes;

        Object.keys(aliases).forEach(function (key) {
          currentRecord[aliases[key]] = currentRecord[key]; // add to array the values with an alias name - assign new key with value of prior key
        });

        currentAddressResults.push(currentRecord); //add formatted results to array

        currentAddressResults.forEach(function (n) {
          n.Type = 'Permit History';  //Add Type field values to each record in array
          n.Link = 'https://wsowa.ci.tacoma.wa.us/cot-itd/addressbased/permithistory.aspx?Address=' + n.Address;   //Add Link field values to each record in array
        });

      });
       checkPH = true;  //Let the setInterval know the Permit History CSV is done
    },

    _Street_format4CSV: function (results, aliases) {  //MJM - Create CSV-style array of with array of results records and array of alias names
      currentStreetResults = [];  //Might do this on Start Over instead!!!
      array.forEach(results, function (record) { //loop through all records & Create array of feature.attributes
        var currentRecord = record.attributes;

        Object.keys(aliases).forEach(function (key) {
          currentRecord[aliases[key]] = currentRecord[key]; // add to array the values with an alias name - assign new key with value of prior key
        });

        currentStreetResults.push(currentRecord); //add formatted results to array

        currentStreetResults.forEach(function (n) {
          n.Type = 'Feature Drawings';  //Add Type field values to each record in array
          n.Link = 'http://www.govme.org/gMap/Info/eVaultFilter.aspx?StreetIDs=' + n.BIGID;   //Add Link field values to each record in array
        });

      });
      checkFD = true;  //Let the setInterval know the Feature Drawings CSV is done
    },

    _exportCSV: function () {  //MJM - using CSVUtils.exportCSV function(filename, datas, columns) - see CSVUtils.js
      //Use MAPTIP because field exists in both street & address points
       CSVUtils.exportCSV('E-Vault Documents', currentAllResults, ['Type', 'MAPTIP', 'Link']); //Missing fields will be dropped - same list for every CSV - make global variable of field names
    },

    _removeGraphic: function (graphicID) {  //MJM - remove highlighted elements (named)
      dojo.forEach(this.map.graphics.graphics, function (g) {
        if (g && g.id === graphicID) {
          this.map.graphics.remove(g);  //remove graphic with specific id
        }
      }, this);
    },
    //END MJM FUNCTIONS ------------------------------------------------------------------------------

    _bindEvent: function () {
      if (this.config.legend.autoUpdate) {
        this.own(on(this._jimuLayerInfos,
          'layerInfosIsShowInMapChanged',
          lang.hitch(this, 'refreshLegend')));

        this.own(on(this._jimuLayerInfos,
          'layerInfosChanged',
          lang.hitch(this, 'refreshLegend')));

        this.own(on(this._jimuLayerInfos,
          'layerInfosRendererChanged',
          lang.hitch(this, 'refreshLegend')));
      }
    },

    _getLayerInfosParam: function () {
      var layerInfosParam;
      if (this.config.legend.layerInfos === undefined) {
        // widget has not been configed.
        layerInfosParam = legendUtils.getLayerInfosParam();
      } else {
        // widget has been configed, respect config.
        layerInfosParam = legendUtils.getLayerInfosParamByConfig(this.config.legend);
      }

      // filter layerInfosParam
      //return this._filterLayerInfsParam(layerInfosParam);
      return layerInfosParam;
    },

    refreshLegend: function () {
      var layerInfos = this._getLayerInfosParam();
      this.legend.refresh(layerInfos);
    }

  });
  return clazz;
});
