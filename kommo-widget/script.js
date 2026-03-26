define(['jquery'], function ($) {
  return function KommoSupportBridge() {
    const self = this;

    function buildStep(handlers) {
      return {
        question: handlers,
        require: []
      };
    }

    function firstNonEmpty() {
      for (let index = 0; index < arguments.length; index += 1) {
        const value = arguments[index];
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }
      return '';
    }

    function resolveEndpointUrl(params) {
      const explicit = firstNonEmpty(params.endpoint_url);
      const fallback = firstNonEmpty(self.params.default_backend_url);
      return explicit || fallback;
    }

    this.callbacks = {
      settings: function () {
        return true;
      },

      init: function () {
        return true;
      },

      bind_actions: function () {
        return true;
      },

      render: function () {
        return true;
      },

      onSave: function () {
        return true;
      },

      destroy: function () {
        return true;
      },

      salesbotDesignerSettings: function (handlerCode, params) {
        return {
          title: self.i18n('salesbot.support_request'),
          text: resolveEndpointUrl(params) || self.i18n('salesbot.endpoint_placeholder')
        };
      },

      onSalesbotDesignerSave: function (_handlerCode, params) {
        const endpointUrl = resolveEndpointUrl(params);

        if (!endpointUrl) {
          throw new Error(self.i18n('salesbot.endpoint_required'));
        }

        const requestData = {
          message: firstNonEmpty(params.message_text) || '{{message_text}}',
          sessionId: firstNonEmpty(params.session_id) || '{{contact.id}}',
          contactPhone: firstNonEmpty(params.contact_phone) || '{{contact.cf.395702}}',
          leadId: firstNonEmpty(params.lead_id) || '{{lead.id}}',
          contactId: firstNonEmpty(params.contact_id) || '{{contact.id}}'
        };

        const flow = [
          buildStep([
            {
              handler: 'widget_request',
              params: {
                url: endpointUrl,
                data: requestData
              }
            },
            {
              handler: 'goto',
              params: {
                type: 'finish',
                step: 1
              }
            }
          ]),
          {
            finish: [
              {
                handler: 'stop',
                params: {}
              }
            ]
          }
        ];

        return JSON.stringify(flow);
      }
    };

    return this;
  };
});
