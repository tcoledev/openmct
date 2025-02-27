/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2021, United States Government
 * as represented by the Administrator of the National Aeronautics and Space
 * Administration. All rights reserved.
 *
 * Open MCT is licensed under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 * http://www.apache.org/licenses/LICENSE-2.0.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 *
 * Open MCT includes source code licensed under additional open source
 * licenses. See the Open Source Licenses file (LICENSES.md) included with
 * this source code distribution or the Licensing information page available
 * at runtime from the About dialog for additional information.
 *****************************************************************************/

define([
    'EventEmitter',
    'lodash',
    './collections/TableRowCollection',
    './TelemetryTableRow',
    './TelemetryTableNameColumn',
    './TelemetryTableColumn',
    './TelemetryTableUnitColumn',
    './TelemetryTableConfiguration'
], function (
    EventEmitter,
    _,
    TableRowCollection,
    TelemetryTableRow,
    TelemetryTableNameColumn,
    TelemetryTableColumn,
    TelemetryTableUnitColumn,
    TelemetryTableConfiguration
) {
    class TelemetryTable extends EventEmitter {
        constructor(domainObject, openmct) {
            super();

            this.domainObject = domainObject;
            this.openmct = openmct;
            this.rowCount = 100;
            this.tableComposition = undefined;
            this.datumCache = [];
            this.configuration = new TelemetryTableConfiguration(domainObject, openmct);
            this.paused = false;
            this.keyString = this.openmct.objects.makeKeyString(this.domainObject.identifier);

            this.telemetryObjects = {};
            this.telemetryCollections = {};
            this.delayedActions = [];
            this.outstandingRequests = 0;

            this.addTelemetryObject = this.addTelemetryObject.bind(this);
            this.removeTelemetryObject = this.removeTelemetryObject.bind(this);
            this.removeTelemetryCollection = this.removeTelemetryCollection.bind(this);
            this.resetRowsFromAllData = this.resetRowsFromAllData.bind(this);
            this.isTelemetryObject = this.isTelemetryObject.bind(this);
            this.refreshData = this.refreshData.bind(this);
            this.updateFilters = this.updateFilters.bind(this);
            this.buildOptionsFromConfiguration = this.buildOptionsFromConfiguration.bind(this);

            this.filterObserver = undefined;

            this.createTableRowCollections();

            openmct.time.on('bounds', this.refreshData);
            openmct.time.on('timeSystem', this.refreshData);
        }

        /**
         * @private
         */
        addNameColumn(telemetryObject, metadataValues) {
            let metadatum = metadataValues.find(m => m.key === 'name');
            if (!metadatum) {
                metadatum = {
                    format: 'string',
                    key: 'name',
                    name: 'Name'
                };
            }

            const column = new TelemetryTableNameColumn(this.openmct, telemetryObject, metadatum);

            this.configuration.addSingleColumnForObject(telemetryObject, column);
        }

        initialize() {
            if (this.domainObject.type === 'table') {
                this.filterObserver = this.openmct.objects.observe(this.domainObject, 'configuration.filters', this.updateFilters);
                this.filters = this.domainObject.configuration.filters;
                this.loadComposition();
            } else {
                this.addTelemetryObject(this.domainObject);
            }
        }

        createTableRowCollections() {
            this.tableRows = new TableRowCollection();

            //Fetch any persisted default sort
            let sortOptions = this.configuration.getConfiguration().sortOptions;

            //If no persisted sort order, default to sorting by time system, ascending.
            sortOptions = sortOptions || {
                key: this.openmct.time.timeSystem().key,
                direction: 'asc'
            };

            this.tableRows.sortBy(sortOptions);
            this.tableRows.on('resetRowsFromAllData', this.resetRowsFromAllData);
        }

        loadComposition() {
            this.tableComposition = this.openmct.composition.get(this.domainObject);

            if (this.tableComposition !== undefined) {
                this.tableComposition.load().then((composition) => {

                    composition = composition.filter(this.isTelemetryObject);
                    composition.forEach(this.addTelemetryObject);

                    this.tableComposition.on('add', this.addTelemetryObject);
                    this.tableComposition.on('remove', this.removeTelemetryObject);
                });
            }
        }

        addTelemetryObject(telemetryObject) {
            this.addColumnsForObject(telemetryObject, true);

            const keyString = this.openmct.objects.makeKeyString(telemetryObject.identifier);
            let requestOptions = this.buildOptionsFromConfiguration(telemetryObject);
            let columnMap = this.getColumnMapForObject(keyString);
            let limitEvaluator = this.openmct.telemetry.limitEvaluator(telemetryObject);

            this.incrementOutstandingRequests();

            const telemetryProcessor = this.getTelemetryProcessor(keyString, columnMap, limitEvaluator);
            const telemetryRemover = this.getTelemetryRemover();

            this.removeTelemetryCollection(keyString);

            this.telemetryCollections[keyString] = this.openmct.telemetry
                .requestCollection(telemetryObject, requestOptions);

            this.telemetryCollections[keyString].on('remove', telemetryRemover);
            this.telemetryCollections[keyString].on('add', telemetryProcessor);
            this.telemetryCollections[keyString].on('clear', this.tableRows.clear);
            this.telemetryCollections[keyString].load();

            this.decrementOutstandingRequests();

            this.telemetryObjects[keyString] = {
                telemetryObject,
                keyString,
                requestOptions,
                columnMap,
                limitEvaluator
            };

            this.emit('object-added', telemetryObject);
        }

        getTelemetryProcessor(keyString, columnMap, limitEvaluator) {
            return (telemetry) => {
                //Check that telemetry object has not been removed since telemetry was requested.
                if (!this.telemetryObjects[keyString]) {
                    return;
                }

                let telemetryRows = telemetry.map(datum => new TelemetryTableRow(datum, columnMap, keyString, limitEvaluator));

                if (this.paused) {
                    this.delayedActions.push(this.tableRows.addRows.bind(this, telemetryRows, 'add'));
                } else {
                    this.tableRows.addRows(telemetryRows, 'add');
                }
            };
        }

        getTelemetryRemover() {
            return (telemetry) => {
                if (this.paused) {
                    this.delayedActions.push(this.tableRows.removeRowsByData.bind(this, telemetry));
                } else {
                    this.tableRows.removeRowsByData(telemetry);
                }
            };
        }

        /**
         * @private
         */
        incrementOutstandingRequests() {
            if (this.outstandingRequests === 0) {
                this.emit('outstanding-requests', true);
            }

            this.outstandingRequests++;
        }

        /**
         * @private
         */
        decrementOutstandingRequests() {
            this.outstandingRequests--;

            if (this.outstandingRequests === 0) {
                this.emit('outstanding-requests', false);
            }
        }

        // will pull all necessary information for all existing bounded telemetry
        // and pass to table row collection to reset without making any new requests
        // triggered by filtering
        resetRowsFromAllData() {
            let allRows = [];

            Object.keys(this.telemetryCollections).forEach(keyString => {
                let { columnMap, limitEvaluator } = this.telemetryObjects[keyString];

                this.telemetryCollections[keyString].getAll().forEach(datum => {
                    allRows.push(new TelemetryTableRow(datum, columnMap, keyString, limitEvaluator));
                });
            });

            this.tableRows.addRows(allRows, 'filter');
        }

        updateFilters(updatedFilters) {
            let deepCopiedFilters = JSON.parse(JSON.stringify(updatedFilters));

            if (this.filters && !_.isEqual(this.filters, deepCopiedFilters)) {
                this.filters = deepCopiedFilters;
                this.tableRows.clear();
                this.clearAndResubscribe();
            } else {
                this.filters = deepCopiedFilters;
            }
        }

        clearAndResubscribe() {
            let objectKeys = Object.keys(this.telemetryObjects);

            this.tableRows.clear();
            objectKeys.forEach((keyString) => {
                this.addTelemetryObject(this.telemetryObjects[keyString].telemetryObject);
            });
        }

        removeTelemetryObject(objectIdentifier) {
            const keyString = this.openmct.objects.makeKeyString(objectIdentifier);

            this.configuration.removeColumnsForObject(objectIdentifier, true);
            this.tableRows.removeRowsByObject(keyString);

            this.removeTelemetryCollection(keyString);
            delete this.telemetryObjects[keyString];

            this.emit('object-removed', objectIdentifier);
        }

        refreshData(bounds, isTick) {
            if (!isTick && this.tableRows.outstandingRequests === 0) {
                this.tableRows.clear();
                this.tableRows.sortBy({
                    key: this.openmct.time.timeSystem().key,
                    direction: 'asc'
                });
                this.tableRows.resubscribe();
            }
        }

        clearData() {
            this.tableRows.clear();
            this.emit('refresh');
        }

        addColumnsForObject(telemetryObject) {
            let metadataValues = this.openmct.telemetry.getMetadata(telemetryObject).values();

            this.addNameColumn(telemetryObject, metadataValues);
            metadataValues.forEach(metadatum => {
                if (metadatum.key === 'name') {
                    return;
                }

                let column = this.createColumn(metadatum);
                this.configuration.addSingleColumnForObject(telemetryObject, column);
                // add units column if available
                if (metadatum.unit !== undefined) {
                    let unitColumn = this.createUnitColumn(metadatum);
                    this.configuration.addSingleColumnForObject(telemetryObject, unitColumn);
                }
            });
        }

        getColumnMapForObject(objectKeyString) {
            let columns = this.configuration.getColumns();

            if (columns[objectKeyString]) {
                return columns[objectKeyString].reduce((map, column) => {
                    map[column.getKey()] = column;

                    return map;
                }, {});
            }

            return {};
        }

        buildOptionsFromConfiguration(telemetryObject) {
            let keyString = this.openmct.objects.makeKeyString(telemetryObject.identifier);
            let filters = this.domainObject.configuration
                && this.domainObject.configuration.filters
                && this.domainObject.configuration.filters[keyString];

            return {filters} || {};
        }

        createColumn(metadatum) {
            return new TelemetryTableColumn(this.openmct, metadatum);
        }

        createUnitColumn(metadatum) {
            return new TelemetryTableUnitColumn(this.openmct, metadatum);
        }

        isTelemetryObject(domainObject) {
            return Object.prototype.hasOwnProperty.call(domainObject, 'telemetry');
        }

        sortBy(sortOptions) {
            this.tableRows.sortBy(sortOptions);

            if (this.openmct.editor.isEditing()) {
                let configuration = this.configuration.getConfiguration();
                configuration.sortOptions = sortOptions;
                this.configuration.updateConfiguration(configuration);
            }
        }

        runDelayedActions() {
            this.delayedActions.forEach(action => action());
            this.delayedActions = [];
        }

        removeTelemetryCollection(keyString) {
            if (this.telemetryCollections[keyString]) {
                this.telemetryCollections[keyString].destroy();
                this.telemetryCollections[keyString] = undefined;
                delete this.telemetryCollections[keyString];
            }
        }

        pause() {
            this.paused = true;
        }

        unpause() {
            this.paused = false;
            this.runDelayedActions();
        }

        destroy() {
            this.tableRows.destroy();

            this.tableRows.off('resetRowsFromAllData', this.resetRowsFromAllData);

            let keystrings = Object.keys(this.telemetryCollections);
            keystrings.forEach(this.removeTelemetryCollection);

            this.openmct.time.off('bounds', this.refreshData);
            this.openmct.time.off('timeSystem', this.refreshData);

            if (this.filterObserver) {
                this.filterObserver();
            }

            if (this.tableComposition !== undefined) {
                this.tableComposition.off('add', this.addTelemetryObject);
                this.tableComposition.off('remove', this.removeTelemetryObject);
            }
        }
    }

    return TelemetryTable;
});
