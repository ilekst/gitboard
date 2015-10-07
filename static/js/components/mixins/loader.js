/**
 * @jsx React.DOM
 */

/*
Copyright (c) 2015 - Andreas Dewes

This file is part of Gitboard.

Gitboard is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <http://www.gnu.org/licenses/>.
*/

define(["react",
        "js/utils",
        "jquery",
        "js/api/all",
        ],function (React,Utils,$,Apis) {

    'use strict';

    var LoaderMixin = {

        /*
        A basic React component can be in one of the following three states:

        - Loading data: The component waits for data from the API to arrive.
        - Ready to use: The component has loaded all data and is ready to be used.
        - Failed to load data: An error occured and the data could not be loaded.

        This component helps to implement a generic workflow for all classes and display
        a loading indicator while resources are being loaded from the backend.

        How to use this component:

        1) Define a `resources` function that returns a list of resource description that your
           component uses. A resource description should contain at least a name and an endpoint
           function that should be called to fetch the resource.
        2) Alternatively, define a `onLoadResources` function that takes care of loading resources.
           This function should wrap all success and error handlers with `looadingSuccess` or
           `loadingError` functions, as discussed below.
        3) When you finished loading resources, either manually call the `loadingSucceeded` 
           function, or wrap your success handler using the `loadingSuccess` function.
        4) If loading should have failed, either call `loadingFailed`, or wrap your error
           handler using the `loadingError` function.
        5) If you want to display a custom loading or error message, define the functions
           `getLoadingMessage` or `getErrorMessage`. Use them to return a valid REACT component,
           which will be rendered instead of the `state.loadingMessage` or `state.errorMessage`
           texts. The `getErrorMessage` function will receive a copy of the error data object that
           you provided to `loadingFailed`, if any.

        Options when defining resources:

        -params     : Parameters that will get passed to the specified API endpoints.
        -endpoint   : The API endpoint to call to fetch the resource
        -success    : The function to call if the loading succeeeds (if any)
        -error      : The function to call if the loading fails (if any)
        -mapping    : How the data should be mapped to the state object if the call succeeds.
                      For every entry in this hash table, the key gives the name of the attribute
                      in the `state` object and the `value` gives the name of the key in the data.
                      If you choose `*` for the value, the whole data will be copied.
                      The mapping will only be used if no `success` handler is defined.
        -nonBlocking: This resource will not keep the component from being rendered while it is being
                      loaded. Useful if you want to already display parts of your component even
                      if the given resource is not yet available to it.
        -nonCritical: Failing to load the resource will not result in the error header being displayed.
        -before     : A function to be called before the API request is triggered. If this function
                      returns false, the resource will not be loaded.

        Global options:

        -silentLoading: Will not display a loading message while resources are being loaded
        */

        updateLoadingState : function(role,state){
            if (!this.isMounted())
                return;
            if (role == undefined)
                role = "default";

            for (var key in this.loadingState){
                var list = this.loadingState[key];
                if (key == state){
                if (!(role in list))
                    list[role] = true;
                }else{
                if (role in list)
                    delete list[role];
                }
            }
        },

        onLoadingError : function(handler,role,nonCritical){
            if (role == undefined)
                role = "default";
            return function(){
                if (!this.isMounted())
                    return;
                if (nonCritical !== undefined)
                    this.updateLoadingState(role,"failedNonCritical");
                else
                    this.updateLoadingState(role,"failed");
                if (handler !== undefined)
                    return handler.apply(this,arguments);
                this.forceUpdate();
            }.bind(this);
        },

        onLoadingSuccess : function(handler,role){
            if (role == undefined)
                role = "default";
            return function(){
                if (!this.isMounted())
                    return;
                this.updateLoadingState(role,"succeeded");
                if (arguments.length > 0)
                {
                    var data = arguments[0];
                    if (this.requestIds !== undefined && this.requestIds[role] !== undefined)
                        if (data.__requestId__ && data.__requestId__ !== this.requestIds[role] && ! data.__cached__){
                            return;
                        }
                }
                if (handler !== undefined)
                    return handler.apply(this,arguments);
            }.bind(this);
        },

        autoLoadResources : function(props,state){
            if (this.onLoadResources !== undefined)
                this.onLoadResources(props);
            var resources = this.resources(props,state);
            if (this.resources === undefined)
                return;
            for(var i in resources){
                var resource = resources[i];
                if (resource.name in this.loadingState.succeeded ||
                    resource.name in this.loadingState.failed ||
                    resource.name in this.loadingState.inProgressNonBlocking ||
                    resource.name in this.loadingState.inProgress)
                    continue;
                if (resource.before)
                    if (!resource.before(props,resource))
                        continue;
                var params = [];
                if (resource.params)
                    params = resource.params.slice(0);

                var onSuccess = function(resource,data){
                    if (resource.success) {
                        resource.success(data);
                        if (resource.mapping === undefined)
                            return;
                    }

                    var mapping = resource.mapping;
                    if (!mapping){
                        mapping = {};
                        mapping[resource.name] = resource.name;
                    }
                    var d = {};
                    for(var key in mapping){
                        d[key] = data[mapping[key]];
                    }
                    this.setState(d);

                }.bind(this,resource);

                params.push(this.onLoadingSuccess(onSuccess,resource.name));
                params.push(this.onLoadingError(resource.error,resource.name,resource.nonCritical));
                this.updateLoadingState(resource.name,resource.nonBlocking !== undefined ? "inProgressNonBlocking" : "inProgress");
                this.requestIds[resource.name] = resource.endpoint.apply(this,params);
            }
        },

        componentDidMount : function(){
            this.loadResources(this.props);
        },

        checkLoadingState : function(props,state){
            var resources = this.resources(props,state);
            for(var i in resources){
                var resource = resources[i];
                for (var state in this.loadingState){
                    if (resource.name in this.loadingState[state]){
                        if (state == 'inProgress'){
                            this.loadingInProgress = true;
                            return;
                        }
                    }
                }
            }
            this.loadingInProgress = false;
        },

        loadResources : function(props){
            this.resetLoadingState();
            if (this.resources)
                this.autoLoadResources(props,this.state);
            if (this.onLoadResources)
                this.onLoadResources(props);
        },

        componentWillReceiveProps : function(props){
            if (JSON.stringify([props.data,props.params]) == JSON.stringify([this.props.data,this.props.params]))
                return false;
            this.loadResources(props)
        },

        resetLoadingState : function(){
            this.loadingState = {
                    inProgress : {},
                    inProgressNonBlocking : {},
                    failed : {}, 
                    failedNonCritical : {},
                    succeeded : {},
                };
        },

        getInitialState : function(){
            return {
                    loaderInitialized : false,
                    loadingMessage : "",
                    loadingErrorMessage : ""};
        },

        componentWillMount : function(){
            this._render = this.render;
            this.render = this.renderLoader;
            this.apis = Apis;
            this.loadingInProgress = true;
            this.requestIds = {};
            this.resetLoadingState();
        },

        renderLoader : function(){
            if (this.loadingInProgress || Object.keys(this.loadingState.failed).length > 0){
                return this.showLoader();
            }
            return this._render();
        },

        componentDidUpdate : function(prevProps,prevState){
            var oldLoadingInProgress = this.loadingInProgress;
            this.autoLoadResources(this.props,this.state);
            this.checkLoadingState(this.props,this.state);
            if (oldLoadingInProgress !== this.loadingInProgress)
                this.forceUpdate();
        },

        showLoader : function(){
            if (this.silentLoading !== undefined)
                return React.createElement("div", null);
            if (Object.keys(this.loadingState.failed).length){
                return this.showErrorMessage();
            }
            else
                return this.showLoadingMessage();
        },

        showErrorMessage : function(){
            var loadingErrorMessage = React.createElement("h3", null, this.state.loadingErrorMessage);
            if (this.getErrorMessage !== undefined)
                loadingErrorMessage = this.getErrorMessage(this.state.loadingErrorData);
            return React.createElement("div", {className: "content"}, 
                React.createElement("div", {className: "container"}, 
                    React.createElement("div", {className: "text-center"}, 
                        React.createElement("h1", null, "An error has occured..."), 
                        React.createElement("h2", null, React.createElement("i", {className: "fa fa-exclamation-triangle"})), 
                        loadingErrorMessage
                    )
                )
            );
        },

        showLoadingMessage : function(){
            var loadingMessage = React.createElement("h3", null, this.state.loadingMessage);
            if (this.getLoadingMessage !== undefined)
                loadingMessage = this.getLoadingMessage();
            return React.createElement("div", {className: "content"}, 
                React.createElement("div", {className: "container"}, 
                    React.createElement("div", {className: "text-center"}, 
                        React.createElement("h1", null, "Loading data..."), 
                        React.createElement("h2", null, React.createElement("i", {className: "fa fa-spin fa-refresh"})), 
                        loadingMessage
                    )
                )
            );
        },

    };

    return LoaderMixin;
});
