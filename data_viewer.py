import dash
import dash_bootstrap_components as dbc
from dash import dcc, html
from dash.dependencies import Input, Output, State
import plotly.graph_objs as go
import pandas as pd
import os
import json
from lib.env import DATA_PATH
from lib.utils import *

if not os.path.isdir(DATA_PATH):
    print("Can't find your DATA_PATH")
    raise FileNotFoundError

if not os.path.exists(f'{DATA_PATH}/0_raw'):
    print("Can't find 0_raw, put participant projects in there")
    raise FileNotFoundError

if not os.path.exists(f'{DATA_PATH}/1_labeled'):
    os.makedirs(f'{DATA_PATH}/1_labeled')

PROJECTS_DIR = f'{DATA_PATH}/0_raw'
PROJECTS = sorted([PROJECT for PROJECT in os.listdir(PROJECTS_DIR) if os.path.isdir(f'{PROJECTS_DIR}/{PROJECT}')])
LABELS_DIR = f'{DATA_PATH}/1_labeled'
DECIMATION_FACTOR = 25
RESTRICT_VIEW_TO_CURRENT_RECORDING = True

regions = None
regions_path = None
labels = None
labels_path = None
app = dash.Dash(__name__, external_stylesheets=[dbc.themes.BOOTSTRAP])

def load_recordings_for_project(project):
    project_dir = f'{PROJECTS_DIR}/{project}'
    recordings = sorted([RECORDING for RECORDING in os.listdir(project_dir) if os.path.isdir(f'{project_dir}/{RECORDING}')])
    return [{'label': recording, 'value': recording} for recording in recordings]

def load_acceleration_data_for_recording(selected_project, selected_recording):
    recording_dir = f'{PROJECTS_DIR}/{selected_project}/{selected_recording}'
    acceleration = pd.read_csv(f'{recording_dir}/acceleration.csv', skiprows=1)
    return acceleration

def update_acceleration_timestamps(acceleration, selected_recording):
    selected_recording = selected_recording.replace(f'_', '-')
    year, month, day, hour, minute, second = [int(item) for item in selected_recording.split('-')]
    acceleration['original_timestamp'] = acceleration.timestamp
    acceleration.timestamp = acceleration.timestamp - acceleration.timestamp[0]
    acceleration.timestamp = acceleration.timestamp + (datetime_to_epoch(year, month, day, hour, minute, second))
    acceleration.timestamp = acceleration.timestamp.astype('datetime64[ns]')
    return acceleration

def create_figure(acceleration):
    global regions,labels
    figure = go.Figure(data=[
        go.Scatter(x=acceleration['timestamp'].iloc[::DECIMATION_FACTOR], y=acceleration['x'].iloc[::DECIMATION_FACTOR], mode='lines', name='X-axis'),
        go.Scatter(x=acceleration['timestamp'].iloc[::DECIMATION_FACTOR], y=acceleration['y'].iloc[::DECIMATION_FACTOR], mode='lines', name='Y-axis'),
        go.Scatter(x=acceleration['timestamp'].iloc[::DECIMATION_FACTOR], y=acceleration['z'].iloc[::DECIMATION_FACTOR], mode='lines', name='Z-axis')
    ])
    if regions:
        for i, region in enumerate(regions):
            if RESTRICT_VIEW_TO_CURRENT_RECORDING:
                if pd.to_datetime(region['end']) < acceleration.timestamp[0] or pd.to_datetime(region['start']) > acceleration.timestamp.iloc[-1]:
                    continue
            figure.add_shape(type='rect',
                             x0=region['start'], x1=region['end'],
                             y0=-40, y1=40,
                             line=dict(color='RoyalBlue'),
                             fillcolor='LightSkyBlue',
                             opacity=0.3,
                             layer='below',
                             name=str(i))
    if labels:
        for i, label in enumerate(labels):
            if RESTRICT_VIEW_TO_CURRENT_RECORDING:
                if pd.to_datetime(label['end']) < acceleration.timestamp[0] or pd.to_datetime(label['start']) > acceleration.timestamp.iloc[-1]:
                    continue
            figure.add_shape(type='rect',
                             x0=label['start'], x1=label['end'],
                             y0=-40, y1=40,
                             line=dict(color='Red'),
                             fillcolor='pink',
                             opacity=0.3,
                             layer='below',
                             name=str(i))
    return figure

app.layout = dbc.Container([
    dbc.Row([
        dbc.Col([
            dbc.Nav([
                html.Label('Select Project:'),
                dcc.Dropdown(
                    id='project-dropdown',
                    options=[{'label': project, 'value': project} for project in PROJECTS],
                    value=PROJECTS[0]
                ),
                html.Label('Select Recording:'),
                dcc.Dropdown(id='recording-dropdown'),
                dbc.Button('Write Region', id='write-button', n_clicks=0, className='mt-2'),
                dbc.Button('Smoking', id='smoking-button', n_clicks=0, className='mt-2',color='success'),
                dbc.Button('Save Regions and Labels', id='save-button', n_clicks=0, className='mt-2',color='info'),
                dbc.Button('Toggle View All Regions and Labels', id='toggle-button', n_clicks=0, className='mt-2',color='secondary'),
                dbc.Button('Delete Smoking Bout', id='delete-button', n_clicks=0, className='mt-2',color='danger'),
            ], vertical=True, pills=True, style={"margin": "20px"})
            
        ], width=2),
        dbc.Col([
            dcc.Graph(
                id='graph',
                style={'height': '90vh'}
            ),
            html.Div(id='xlim-output', className='mt-2'),
        ], width=10)
    ]),
    dbc.Row([
        dbc.Col([
            html.Footer('Developed by Andrew', className='text-center mt-4')
        ])
    ])
], fluid=True)

start_point = None
end_point = None
acceleration = None

@app.callback(
    Output('recording-dropdown', 'options'),
    Input('project-dropdown', 'value'),
)
def on_change_project_set_recording_options(selected_project):
    global regions,regions_path,labels,labels_path

    regions_path = f'{LABELS_DIR}/{selected_project}/regions.json'
    labels_path = f'{LABELS_DIR}/{selected_project}/labels.json'

    if not os.path.isdir(f'{LABELS_DIR}/{selected_project}'):
        os.makedirs(f'{LABELS_DIR}/{selected_project}')

    if os.path.isfile(regions_path):
        with open(regions_path,'r') as f:
            regions = json.load(f)
    else:
        regions = []

    if os.path.isfile(labels_path):
        with open(labels_path,'r') as f:
            labels = json.load(f)
    else:
        labels = []

    return load_recordings_for_project(selected_project)

@app.callback(
    Output('recording-dropdown', 'value'),
    Input('recording-dropdown', 'options'),
    prevent_initial_call=True
)
def set_recording_value(available_options):
    return available_options[0]['value'] if available_options else None

@app.callback(
    Output('graph', 'figure'),
    [Input('project-dropdown', 'value'),
     Input('recording-dropdown', 'value')],
    prevent_initial_call=True
)
def update_graph(selected_project, selected_recording):
    global acceleration
    if selected_project and selected_recording:
        acceleration = load_acceleration_data_for_recording(selected_project, selected_recording)
        acceleration = update_acceleration_timestamps(acceleration, selected_recording)
        global original_acceleration
        original_acceleration = acceleration.copy()
        
        return create_figure(acceleration)
    return go.Figure()

@app.callback(
    Output('xlim-output', 'children'),
    Input('graph', 'relayoutData')
)
def update_xlim(relayout_data):
    if relayout_data and 'xaxis.range[0]' in relayout_data and 'xaxis.range[1]' in relayout_data:
        xlim = (relayout_data['xaxis.range[0]'], relayout_data['xaxis.range[1]'])
        return f"Selected x-axis limits: {xlim}"
    return "No zoom action detected"

@app.callback(
    Output('graph', 'figure', allow_duplicate=True),
    [Input('write-button', 'n_clicks')],
    State('graph', 'relayoutData'),
    prevent_initial_call=True
)
def write_region(write_n_clicks, relayout_data):
    global acceleration, DECIMATION_FACTOR, regions
    if acceleration is None:
        return go.Figure()

    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]['prop_id'].split('.')[0]

    if triggered_id == 'write-button':
        if write_n_clicks > 0:
            if relayout_data and 'xaxis.range[0]' in relayout_data and 'xaxis.range[1]' in relayout_data:
                xlim_start = relayout_data['xaxis.range[0]']
                xlim_end = relayout_data['xaxis.range[1]']
            else:
                print('using accel timestamps')
                xlim_start = acceleration.timestamp.iloc[0]
                xlim_end = acceleration.timestamp.iloc[-1]

            region = {'start': str(xlim_start), 'end': str(xlim_end)}
            regions.append(region)

            return create_figure(acceleration)
    

@app.callback(
    Input('save-button', 'n_clicks'),
    prevent_initial_call=True
)
def save_regions_and_labels(save_n_clicks):
    global regions,regions_path,labels,labels_path

    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]['prop_id'].split('.')[0]

    if triggered_id == 'save-button':
        if save_n_clicks > 0:
            with open(regions_path,'w') as f:
                json.dump(regions,f)
            with open(labels_path,'w') as f:
                json.dump(labels,f)

@app.callback(
    Output('graph', 'figure', allow_duplicate=True),
    Input('smoking-button', 'n_clicks'),
    State('graph', 'relayoutData'),
    prevent_initial_call=True
)
def add_smoking_label(n_clicks,relayout_data):
    global labels,labels_path

    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]['prop_id'].split('.')[0]

    if triggered_id == 'smoking-button':
        if n_clicks > 0:
            if relayout_data and 'xaxis.range[0]' in relayout_data and 'xaxis.range[1]' in relayout_data:
                xlim_start = relayout_data['xaxis.range[0]']
                xlim_end = relayout_data['xaxis.range[1]']

            xlim_start_text = str(xlim_start).replace(' ', '-').replace(':', '-')
            if '.' in xlim_start_text:
                xlim_start_text = "".join(xlim_start_text.split('.')[:-1])
            xlim_end_text = str(xlim_end).replace(' ', '-').replace(':', '-')
            if '.' in xlim_end_text:
                xlim_end_text = "".join(xlim_end_text.split('.')[:-1])

            label = {'start': str(xlim_start), 'end': str(xlim_end)}
            labels.append(label)

            return create_figure(acceleration)
        
@app.callback(
    Output('graph', 'figure', allow_duplicate=True),
    Input('delete-button', 'n_clicks'),
    State('graph', 'relayoutData'),
    prevent_initial_call=True
)
def delete_smoking_label(n_clicks,relayout_data):
    global labels,labels_path

    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]['prop_id'].split('.')[0]

    if triggered_id == 'delete-button':
        if n_clicks > 0:
            if relayout_data and 'xaxis.range[0]' in relayout_data and 'xaxis.range[1]' in relayout_data:
                xlim_start = relayout_data['xaxis.range[0]']
                xlim_end = relayout_data['xaxis.range[1]']

            labels_to_delete = [label for label in labels if xlim_start > label['start'] and xlim_end < label['end']]
            regions_to_delete = [region for region in regions if xlim_start > region['start'] and xlim_end < region['end']]

            if len(labels_to_delete) == 1:
                label_to_delete = labels_to_delete[0]
                labels.remove(label_to_delete)
            elif len(regions_to_delete) == 1:
                region_to_delete = regions_to_delete[0]
                regions.remove(region_to_delete)
            return create_figure(acceleration)
        
@app.callback(
    Output('graph', 'figure', allow_duplicate=True),
    Input('toggle-button', 'n_clicks'),
    prevent_initial_call=True
)
def toggle_view_all_regions_and_labels(n_clicks):
    global regions,regions_path,RESTRICT_VIEW_TO_CURRENT_RECORDING

    ctx = dash.callback_context
    triggered_id = ctx.triggered[0]['prop_id'].split('.')[0]

    if triggered_id == 'toggle-button':
        if n_clicks > 0:
            RESTRICT_VIEW_TO_CURRENT_RECORDING = not RESTRICT_VIEW_TO_CURRENT_RECORDING
    return create_figure(acceleration)

if __name__ == '__main__':
    app.run_server(debug=True)
