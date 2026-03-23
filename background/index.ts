import type { PluginDefinition, RawIdentity } from './sdk';

const plugin: PluginDefinition = {
    onStart: (_identity: RawIdentity) => {},
    onEnd: () => {},
    onSettingsUpdate: (_settings: any) => {
        // No settings defined for the example plugin yet.
    },
    routes: {
        get: {
            something: {
                description: 'Endpoint to get some data',
                handler: (req, res) => {
                    res.json({ data: 'some data' });
                },
            },
        },
        post: {
            something: {
                description: 'Endpoint to post some data.',
                handler: (req, res) => {
                    res.json({ data: 'some data' });
                },
            },
        },
    },
};

export = plugin;
