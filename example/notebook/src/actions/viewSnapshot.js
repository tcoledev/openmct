/*****************************************************************************
 * Open MCT, Copyright (c) 2014-2017, United States Government
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

/**
 * Module defining viewSnapshot (Originally NewWindowAction). Created by vwoeltje on 11/18/14.
 */
define(
    [],
    function () {

        var OVERLAY_TEMPLATE = '' +
        '    <div class="abs blocker"></div>' +
        '    <div class="abs outer-holder">' +
        '       <a class="close icon-x-in-circle"></a>' +
        '       <div class="abs inner-holder l-flex-col">' +
        '           <div class="t-contents flex-elem holder grows"></div>' +
        '           <div class="bottom-bar flex-elem holder">' +
        '               <a class="t-done s-button major">Done</a>' +
        '           </div>' +
        '       </div>' +
        '    </div>';


        function viewSnapshot($compile,context) {
            context = context || {};

            this.$compile = $compile;

            var toggleOverlay,
                overlay,
                closeButton,
                doneButton,
                blocker,
                overlayContainer,
                img,
                annotateButton;
            
        }

        function openOverlay(url,header) {
            overlay = document.createElement('div');
            $(overlay).addClass('abs overlay l-large-view');
            overlay.innerHTML = OVERLAY_TEMPLATE;
            overlayContainer = overlay.querySelector('.t-contents');
            closeButton = overlay.querySelector('a.close');
            closeButton.addEventListener('click', toggleOverlay);
            doneButton = overlay.querySelector('a.t-done');
            doneButton.addEventListener('click', toggleOverlay);
            blocker = overlay.querySelector('.abs.blocker');
            blocker.addEventListener('click', toggleOverlay);
            annotateButton = header.querySelector('a.icon-pencil');
            annotateButton.addEventListener('click', annotateImg);
            document.body.appendChild(overlay);
            img = document.createElement('img');
            img.src = url; 
            overlayContainer.appendChild(header);
            overlayContainer.appendChild(img);
        }

        function closeOverlay() {
            overlayContainer.removeChild(img);
            document.body.removeChild(overlay);
            closeButton.removeEventListener('click', toggleOverlay);
            closeButton = undefined;
            doneButton.removeEventListener('click', toggleOverlay);
            doneButton = undefined;
            blocker.removeEventListener('click', toggleOverlay);
            blocker = undefined;
            overlayContainer = undefined;
            overlay = undefined;
            img = undefined;
        }

        function headerTemplate(){
            var template = '<div class="view-header">'+
                            '<mct-representation '+
                                'key="\'object-header-frame\'" '+
                                'mct-object="selObj" '+
                                'class="l-flex-row flex-elem object-header grows view-snap-info">'+
                            '</mct-representation> '+
                            '<div class="view-date">'+
                            'SNAPSHOT {{snapDate | date:\'yy-dd-MM hh:mm:ss\'}}</div>'+
                            '<a class="s-button icon-pencil" title="Annotate">'+
                                '<span class="title-label">Annotate</span>'+
                            '</a>'+
                            '</div>';
            return template;
        }


        viewSnapshot.prototype.perform = function($event,snapshot,embedId,entryId,$scope,domainObject) {
            var isOpen = false;

             // Create the overlay element and add it to the document's body
            $scope.selObj = domainObject;
            $scope.snapDate = +embedId;
            element = this.$compile(headerTemplate())($scope);

            var annotateAction = $scope.action.getActions({category: 'embed'})[1];

            toggleOverlay = function () {
                if (!isOpen) {
                    openOverlay(snapshot,element[0]);
                    isOpen = true;
                } else {
                    closeOverlay();
                    isOpen = false;
                }
            };

            annotateImg = function () {
                closeOverlay();
                annotateAction.perform($event,snapshot,embedId,entryId,$scope);
            };



            
            toggleOverlay();
        };

        return viewSnapshot;
    }
);
