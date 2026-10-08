package com.example.visibility;

import java.util.ArrayList;
import java.util.List;

import com.vaadin.flow.component.Component;
import com.vaadin.flow.component.Text;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.formlayout.FormLayout;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.Span;
import com.vaadin.flow.component.orderedlayout.HorizontalLayout;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.vaadin.flow.component.textfield.TextField;
import com.vaadin.flow.data.value.ValueChangeMode;
import com.vaadin.flow.router.BeforeEnterEvent;
import com.vaadin.flow.router.BeforeEnterObserver;
import com.vaadin.flow.router.Route;

/**
 * Four containers inside one parent; panel 1 visible, panels 2-4 set invisible.
 *
 * Query parameters select the variant:
 *   kind  = div | vertical | horizontal | form   (container type, default div)
 *   when  = before | after | delayed             (setVisible(false) before add(), after add(), or only on
 *                                                 the first roundtrip once the panels were rendered visible;
 *                                                 default before)
 *   mode  = static | rebuild | reattach | resend (what each roundtrip does, default static)
 *             static   - nothing; the roundtrip only updates the server-state label
 *             rebuild  - removeAll() and add four NEW panels, 2-4 invisible again
 *             reattach - removeAll() and re-add the SAME four panel instances
 *             resend   - setVisible(true) then setVisible(false) on panels 2-4
 *   style = none | class | inline                (display:flex on the panels, default none)
 *
 * In every mode the server ends each roundtrip with panel 1 visible and 2-4 invisible,
 * so the DOM must show exactly that after every roundtrip.
 */
@Route("")
public class VisibilityView extends VerticalLayout implements BeforeEnterObserver {

    private final List<Component> panels = new ArrayList<>();
    private final Span serverState = new Span();
    private final VerticalLayout parent = new VerticalLayout();
    private int roundtrips;
    private String kind;
    private String mode;
    private String style;
    private String when;

    @Override
    public void beforeEnter(BeforeEnterEvent event) {
        removeAll();
        panels.clear();
        roundtrips = 0;

        var params = event.getLocation().getQueryParameters().getParameters();
        kind = params.getOrDefault("kind", List.of("div")).getFirst();
        when = params.getOrDefault("when", List.of("before")).getFirst();
        mode = params.getOrDefault("mode", List.of("static")).getFirst();
        style = params.getOrDefault("style", List.of("none")).getFirst();

        parent.removeAll();
        parent.setId("parent");
        buildPanels();

        Button roundtrip = new Button("Roundtrip", e -> onRoundtrip());
        roundtrip.setId("roundtrip");

        TextField field = new TextField("Edit me");
        field.setId("field");
        field.setValueChangeMode(ValueChangeMode.EAGER);
        field.addValueChangeListener(e -> onRoundtrip());

        serverState.setId("server-state");
        refreshServerState();
        roundtrips = 0;
        serverState.getElement().setAttribute("data-roundtrips", "0");

        add(new Span("kind=" + kind + ", when=" + when + ", mode=" + mode + ", style=" + style),
                roundtrip, field, serverState, parent);
    }

    private void buildPanels() {
        panels.clear();
        for (int i = 1; i <= 4; i++) {
            Component panel = createContainer(kind, "Panel " + i);
            panel.setId("panel-" + i);
            switch (style) {
                case "class" -> panel.getElement().getClassList().add("panel-flex");
                case "inline" -> panel.getElement().getStyle().set("display", "flex");
                default -> { }
            }
            panels.add(panel);
            if ("before".equals(when) && i > 1) {
                panel.setVisible(false);
            }
            parent.add(panel);
            if ("after".equals(when) && i > 1) {
                panel.setVisible(false);
            }
        }
    }

    private void onRoundtrip() {
        if ("delayed".equals(when) && roundtrips == 0) {
            panels.stream().skip(1).forEach(p -> p.setVisible(false));
        }
        switch (mode) {
            case "rebuild" -> {
                parent.removeAll();
                buildPanels();
            }
            case "reattach" -> {
                parent.removeAll();
                panels.forEach(parent::add);
            }
            case "resend" -> panels.stream().skip(1).forEach(p -> {
                p.setVisible(true);
                p.setVisible(false);
            });
            default -> { }
        }
        refreshServerState();
    }

    private void refreshServerState() {
        roundtrips++;
        StringBuilder sb = new StringBuilder();
        for (Component p : panels) {
            sb.append(p.getId().orElseThrow()).append('=').append(p.isVisible()).append(' ');
        }
        serverState.setText(sb.toString().trim());
        serverState.getElement().setAttribute("data-roundtrips", String.valueOf(roundtrips));
    }

    private static Component createContainer(String kind, String label) {
        return switch (kind) {
            case "vertical" -> new VerticalLayout(new Span(label));
            case "horizontal" -> new HorizontalLayout(new Span(label));
            case "form" -> new FormLayout(new Span(label));
            default -> new Div(new Text(label));
        };
    }
}
