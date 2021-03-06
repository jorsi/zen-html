import { dynamicMarker, ZenTemplate } from './zen-template';
import { render } from './render';

/**
 * A cache of nested templates.
 */
export const templateCache = new WeakMap<Node, DynamicNode>();

export class DynamicNode {
    values: DynamicValue[] = [];
    renderables: RenderableArea[] = [];
    constructor (node: Node) {
        this.parse(node);
    }
    /**
     * Updates all values contained in the dynamic node.
     * @param values array of values from a zen template
     */
    update (values: any[]) {
        for (let i = 0; i < values.length; i++) {
            let value = values[i];
            let dynamicValue = this.values[i];
            if (value !== dynamicValue.currentValue) {
                // avoid unneccessary updates
                dynamicValue.oldValue = dynamicValue.currentValue;
                dynamicValue.currentValue = value;
            }
        };
    }

    render () {
        for (let renderable of this.renderables) {
            switch (renderable.area) {
                case 'attribute':
                    this.renderAttribute(renderable);
                    break;
                case 'textContent':
                    this.renderTextContent(renderable);
                    break;
            }
        }
    }

    private parse (node: Node) {
        // walk over the element and save all dynamic marker nodes
        const treeWalker = document.createTreeWalker(node, 5 /** only elements and text */);
        const nodesToRemove = [];
        while(treeWalker.nextNode()) {
            const currentNode = treeWalker.currentNode;
            if (currentNode instanceof Element) {
                // if element, traverse attributes
                for (let i = 0; i < currentNode.attributes.length; i++) {
                    let currentAttribute = currentNode.attributes[i];
                    if (currentAttribute.textContent.indexOf(dynamicMarker) > -1) {
                        // parse dynamic values in attribute
                        const textContent = currentAttribute.textContent;
                        const matches = textContent.match(new RegExp(dynamicMarker, 'g'));
                        const dynamicValuesCount = matches ? matches.length : 0;
                        const dynamicValues: DynamicValue[] = [];
                        for (let i = 0; i < dynamicValuesCount; i++) {
                            dynamicValues.push({
                                currentValue: dynamicMarker,
                                oldValue: null
                            });
                        }
                        this.values = this.values.concat(dynamicValues);

                        // create renderable
                        this.renderables.push({
                            area: 'attribute',
                            container: currentAttribute,
                            template: currentAttribute.textContent,
                            values: dynamicValues
                        });
                    }
                }
            } else if (currentNode.textContent.indexOf(dynamicMarker) > -1) {
                // if it's not an element, must be in a text position

                /**
                 * We can break the textContent string into multiple
                 * TextNodes, so that each dynamic part is isolated and
                 * can update by itself.
                 */
                const dynamicMarkerIndices = [];
                const textParts = [];
                let textContent = currentNode.textContent;
                while (textContent !== '') {
                    let part;
                    const valueIndex = textContent.indexOf(dynamicMarker);
                    if (valueIndex > 0) {
                        // text content before value marker
                        part = textContent.substring(0, valueIndex);
                        textContent = textContent.substring(valueIndex);
                    } else if (valueIndex === 0) {
                        // value marker
                        dynamicMarkerIndices.push(textParts.length);
                        part = textContent.substring(0, dynamicMarker.length);
                        textContent = textContent.substring(dynamicMarker.length);
                    } else {
                        // last text content after value marker
                        part = textContent.substring(0);
                        textContent = '';
                    }
                    textParts.push(document.createTextNode(part));
                }

                // insert new text nodes before current node
                // ** warning: can't appendChild() or else walker
                // ** will keep adding and walking over nodes **
                const parentNode = currentNode.parentElement;
                for (let i = 0; i < textParts.length; i++) {
                    parentNode.insertBefore(textParts[i], currentNode);
                }

                // must clean up afterward to prevent walker from breaking
                nodesToRemove.push(currentNode);

                // create values and renderables for each
                // dynamic value
                for (let i = 0; i < dynamicMarkerIndices.length; i++) {
                    const dynamicValue = {
                        currentValue: dynamicMarker,
                        oldValue: null
                    };
                    this.values.push(dynamicValue);
                    this.renderables.push({
                        area: 'textContent',
                        container: textParts[dynamicMarkerIndices[i]],
                        template: dynamicMarker,
                        values: [dynamicValue]
                    });
                }
            }
        }

        // clean up old nodes
        for (let nodeToRemove of nodesToRemove) {
            nodeToRemove.parentElement.removeChild(nodeToRemove);
        }
    }

    /**
     * Renders a new attribute value by
     * rebuilding the raw string and replacing
     * each dynamic part with their current values
     * @param renderable a dynamic attribute value
     */
    private renderAttribute(renderable: RenderableArea) {
        let attributeValue = renderable.template;
        for (let j = 0; j < renderable.values.length; j++) {
            attributeValue = attributeValue.replace(dynamicMarker, renderable.values[j].currentValue);
        }
        renderable.container.textContent = attributeValue;
    }

    /**
     * Renders value into a textContent area. Primitive values
     * can be directly rendered into textContent, however, ZenTemplate
     * values must be parsed correctly.
     * @param renderable a dynamic text node
     */
    private renderTextContent(renderable: RenderableArea) {
        // determine value
        const value = renderable.values[0];
        if (value.currentValue instanceof ZenTemplate) {
            // check if this template was rendered before
            if (value.currentValue !== value.oldValue) {
                // this template hasn't been rendered before
                let dynamicNode = templateCache.get(renderable.container);
                if (!dynamicNode) {
                    // container has not been rendered into before.
                    // clone, parse, and insert template
                    const template = value.currentValue.clone();
                    dynamicNode = new DynamicNode(template);

                    // create comment marker and replace text content
                    const commentMarker = document.createComment('');
                    renderable.container.parentElement.insertBefore(commentMarker, renderable.container);
                    renderable.container.parentElement.insertBefore(template, renderable.container);
                    renderable.container.parentElement.removeChild(renderable.container);
                    renderable.container = commentMarker;
                    // set container
                    templateCache.set(renderable.container, dynamicNode);
                }
                dynamicNode.update(value.currentValue.values);
                dynamicNode.render();
            }
        } else {
            renderable.container.textContent = renderable.values[0].currentValue;
        }
    }
}

interface DynamicValue {
    currentValue: any;
    oldValue: any;
}
interface RenderableArea {
    area: 'textContent' | 'attribute';
    container: Node;
    template: string;
    values: DynamicValue[];
}