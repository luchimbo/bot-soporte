define(['jquery'], function ($) {
  return function KommoSupportWidget() {
    var self = this;
    var PLACEHOLDER_URL = 'https://example.com/kommo/widget-request';

    function normalizeEndpointUrl(value) {
      var normalized = String(value || '').trim();
      if (!normalized || normalized === PLACEHOLDER_URL) {
        return '';
      }
      return normalized;
    }

    function createWidgetRequestStep(endpointUrl) {
      return {
        question: [
          {
            handler: 'widget_request',
            params: {
              url: endpointUrl,
              data: buildRequestData()
            }
          },
          {
            handler: 'goto',
            params: {
              type: 'question',
              step: 1
            }
          }
        ],
        require: []
      };
    }

    function buildRequestData() {
      return {
        message: '{{message_text}}',
        lead_id: '{{lead.id}}',
        contact_id: '{{contact.id}}',
        talk_id: '{{talk_id}}',
        source: 'kommo_salesbot',
        render_mode: 'salesbot_show'
      };
    }

    function createShowReplyStep() {
      return {
        question: [
          {
            handler: 'show',
            params: {
              type: 'text',
              value: '{{json.reply}}'
            }
          }
        ],
        require: []
      };
    }

    this.callbacks = {
      settings: function () {
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
      onSalesbotDesignerSave: function (_handlerCode, params) {
        var endpointUrl = normalizeEndpointUrl(params && params.endpoint_url);

        if (!endpointUrl) {
          endpointUrl = normalizeEndpointUrl(self.get_settings().default_backend_url);
        }

        if (!endpointUrl) {
          endpointUrl = PLACEHOLDER_URL;
        }

        return JSON.stringify([
          createWidgetRequestStep(endpointUrl),
          createShowReplyStep()
        ]);
      },
      destroy: function () {
      },
      onSave: function () {
        return true;
      }
    };

    return this;
  };
});
